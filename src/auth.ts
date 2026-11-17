// Sign-in. Everything provider-specific lives in this file: the rest of the app only needs
// a { id, handle, name, avatar } identity and a signed session cookie.

import { type Env, type User, HANDLE_RE, b64url, cookies, html, redirect, safeNext, seal, setCookie, sha256, unseal } from "./util";
import { devLoginPage, messagePage } from "./views";

const SESSION_DAYS = 30;

export async function sessionUserId(req: Request, env: Env): Promise<string | null> {
  const s = await unseal<{ uid: string }>(env.SESSION_SECRET, cookies(req).s);
  return s?.uid ?? null;
}

export async function upsertUser(env: Env, u: User): Promise<void> {
  const now = Date.now();
  // A handle belongs to whoever signed in with it most recently. If it used to belong to another
  // account (X handles can be released and reused), that account loses it and must sign in again.
  const lower = u.handle.toLowerCase();
  const previousOwner = await env.DB.prepare("SELECT id FROM users WHERE handle_lower = ? AND id != ?").bind(lower, u.id).first();
  if (previousOwner) {
    // Appeals and notes addressed to the previous owner of this handle are not for the new one.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM appeals WHERE to_handle = ?").bind(lower),
      env.DB.prepare("UPDATE users SET handle_lower = '' WHERE handle_lower = ? AND id != ?").bind(lower, u.id),
    ]);
  }
  const self = await env.DB.prepare("SELECT handle_lower FROM users WHERE id = ?").bind(u.id).first<{ handle_lower: string }>();
  if (self && self.handle_lower && self.handle_lower !== lower) {
    // This person renamed their X account: their received appeals follow them to the new handle.
    await env.DB.batch([
      env.DB.prepare("UPDATE OR IGNORE appeals SET to_handle = ? WHERE to_handle = ?").bind(lower, self.handle_lower),
      env.DB.prepare("DELETE FROM appeals WHERE to_handle = ?").bind(self.handle_lower),
    ]);
  }
  await env.DB.prepare(
    `INSERT INTO users (id, handle, handle_lower, name, avatar, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(id) DO UPDATE SET handle = ?2, handle_lower = ?3, name = ?4, avatar = ?5, updated_at = ?6`,
  )
    .bind(u.id, u.handle, u.handle.toLowerCase(), u.name, u.avatar, now)
    .run();
}

async function startSession(env: Env, uid: string, next: string, secure: boolean): Promise<Response> {
  const s = await seal(env.SESSION_SECRET, { uid }, SESSION_DAYS * 86400);
  return redirect(next, [
    ["Set-Cookie", setCookie("s", s, SESSION_DAYS * 86400, secure)],
    ["Set-Cookie", setCookie("o", "", 0, secure)],
  ]);
}

export function logout(secure: boolean): Response {
  return redirect("/", [["Set-Cookie", setCookie("s", "", 0, secure)]]);
}

// ---------- X OAuth 2.0 (authorization code + PKCE) ----------

export async function loginStart(env: Env, url: URL): Promise<Response> {
  const next = safeNext(url.searchParams.get("next"));
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) {
    if (env.DEV_LOGIN === "1") return redirect(`/auth/dev?next=${encodeURIComponent(next)}`);
    return html(
      messagePage("Sign-in opens soon", `Sign in with X is being connected. You can already look up any page at ${url.host}/@handle.`),
      503,
    );
  }
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const auth = new URL("https://x.com/i/oauth2/authorize");
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: env.X_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    scope: "users.read tweet.read", // read-only: we only need to know who you are
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  const o = await seal(env.SESSION_SECRET, { state, verifier, next }, 600);
  return redirect(auth.toString(), [["Set-Cookie", setCookie("o", o, 600, url.protocol === "https:")]]);
}

export async function loginCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const o = await unseal<{ state: string; verifier: string; next: string }>(env.SESSION_SECRET, cookies(req).o);
  const code = url.searchParams.get("code");
  if (!o || !code || url.searchParams.get("state") !== o.state) {
    return html(messagePage("Sign-in didn't complete", "X didn't confirm the sign-in, or it took longer than 10 minutes. Try again."), 400);
  }
  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/auth/callback`,
      code_verifier: o.verifier,
    }),
  });
  if (!tokenRes.ok) {
    console.error("x token exchange failed", tokenRes.status, await tokenRes.text());
    return html(messagePage("Sign-in didn't complete", "X rejected the sign-in. Try again."), 502);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  // The one X API call we make per sign-in. The token is discarded afterwards.
  const meRes = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) {
    console.error("x users/me failed", meRes.status, await meRes.text());
    return html(messagePage("Sign-in didn't complete", "X didn't return your profile. Try again."), 502);
  }
  const me = ((await meRes.json()) as { data: { id: string; username: string; name: string; profile_image_url?: string } }).data;
  const avatar = me.profile_image_url?.startsWith("https://pbs.twimg.com/") ? me.profile_image_url.replace("_normal", "_200x200") : null;
  await upsertUser(env, { id: me.id, handle: me.username, name: me.name, avatar });
  // Drop the cached profile picture so a new one shows up straight away.
  await caches.default.delete(new Request(`${url.origin}/avatar/${me.username.toLowerCase()}`));
  return startSession(env, me.id, o.next, url.protocol === "https:");
}

/** Local-only stand-in for X sign-in. Unreachable unless DEV_LOGIN=1 (set in .dev.vars, never in production). */
export async function devLogin(env: Env, url: URL): Promise<Response> {
  if (env.DEV_LOGIN !== "1") return new Response("Not found", { status: 404 });
  const next = safeNext(url.searchParams.get("next"));
  const handle = url.searchParams.get("handle");
  if (!handle || !HANDLE_RE.test(handle)) {
    const { results } = await env.DB.prepare("SELECT id, handle, name, avatar FROM users WHERE id LIKE 'dev:%' ORDER BY handle LIMIT 12").all<User>();
    return html(devLoginPage(results, next));
  }
  const id = `dev:${handle.toLowerCase()}`;
  const existing = await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(id).first<{ name: string }>();
  await upsertUser(env, { id, handle, name: existing?.name ?? handle, avatar: null });
  return startSession(env, id, next, false);
}
