import { homePage, profilePage, messagePage, type User } from "./views";

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  /** "1" only in .dev.vars: enables /auth/dev so the site can be tested without X credentials. */
  DEV_LOGIN?: string;
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const NOTE_MAX = 280;
const DAILY_APPEAL_LIMIT = 20;
const SESSION_DAYS = 30;

// ---------- small helpers ----------

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Signed, expiring cookie payloads: base64url(json).hmac */
async function seal(secret: string, payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })));
  return `${body}.${await hmac(secret, body)}`;
}

async function unseal<T>(secret: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const bytes = Uint8Array.from(unb64url(body), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function setCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

function html(body: string, status = 200, extra: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' https://pbs.twimg.com data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ...extra,
    },
  });
}

function redirect(location: string, headers: [string, string][] = []): Response {
  const h = new Headers({ Location: location });
  for (const [k, v] of headers) h.append(k, v);
  return new Response(null, { status: 303, headers: h });
}

function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, "http://x");
  u.searchParams.set(key, value);
  return u.pathname + u.search;
}

// ---------- data ----------

async function currentUser(req: Request, env: Env): Promise<User | null> {
  const s = await unseal<{ uid: string }>(env.SESSION_SECRET, cookies(req).s);
  if (!s) return null;
  return await env.DB.prepare("SELECT id, handle, name, avatar FROM users WHERE id = ?").bind(s.uid).first<User>();
}

async function upsertUser(env: Env, u: User): Promise<void> {
  const now = Date.now();
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

// ---------- X OAuth 2.0 (authorization code + PKCE) ----------

async function loginStart(req: Request, env: Env, url: URL): Promise<Response> {
  const next = safeNext(url.searchParams.get("next"));
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) {
    if (env.DEV_LOGIN === "1") return redirect(`/auth/dev?next=${encodeURIComponent(next)}`);
    return html(messagePage("Sign-in isn't set up yet", "X_CLIENT_ID and X_CLIENT_SECRET haven't been added to this deployment."), 503);
  }
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  const auth = new URL("https://x.com/i/oauth2/authorize");
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: env.X_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    scope: "users.read tweet.read", // read-only: we only need to know who you are
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const o = await seal(env.SESSION_SECRET, { state, verifier, next }, 600);
  return redirect(auth.toString(), [["Set-Cookie", setCookie("o", o, 600, url.protocol === "https:")]]);
}

async function loginCallback(req: Request, env: Env, url: URL): Promise<Response> {
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
  const avatar = me.profile_image_url?.startsWith("https://pbs.twimg.com/") ? me.profile_image_url.replace("_normal", "_bigger") : null;
  await upsertUser(env, { id: me.id, handle: me.username, name: me.name, avatar });
  return startSession(env, me.id, o.next, url.protocol === "https:");
}

/** Local-only stand-in for X sign-in. Unreachable unless DEV_LOGIN=1 (set in .dev.vars, never in production). */
async function devLogin(env: Env, url: URL): Promise<Response> {
  if (env.DEV_LOGIN !== "1") return new Response("Not found", { status: 404 });
  const next = safeNext(url.searchParams.get("next"));
  const handle = url.searchParams.get("handle");
  if (!handle || !HANDLE_RE.test(handle)) {
    return html(
      messagePage(
        "Dev sign-in",
        "Local testing only. Pick a handle to sign in as.",
        `<form method="get" action="/auth/dev" class="row"><input type="hidden" name="next" value="${next.replace(/"/g, "&quot;")}"><input name="handle" placeholder="handle" required pattern="[A-Za-z0-9_]{1,15}" autofocus><button class="btn">Sign in</button></form>`,
      ),
    );
  }
  const id = `dev:${handle.toLowerCase()}`;
  await upsertUser(env, { id, handle, name: handle, avatar: null });
  return startSession(env, id, next, false);
}

// ---------- appeals ----------

async function postAppeal(req: Request, env: Env, me: User): Promise<Response> {
  const form = await req.formData();
  const back = safeNext(String(form.get("back") ?? "/"));
  const to = String(form.get("to") ?? "").trim().replace(/^@/, "");
  const note = String(form.get("note") ?? "").replace(/\r\n/g, "\n").trim();
  if (!HANDLE_RE.test(to)) return redirect(withParam(back, "err", "handle"));
  if (to.toLowerCase() === me.handle.toLowerCase()) return redirect(withParam(back, "err", "self"));
  if ([...note].length > NOTE_MAX) return redirect(withParam(back, "err", "long"));

  const toLower = to.toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM appeals WHERE from_id = ? AND to_handle = ?").bind(me.id, toLower).first();
  if (!existing) {
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM appeals WHERE from_id = ? AND created_at > ?")
      .bind(me.id, Date.now() - 86400_000)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= DAILY_APPEAL_LIMIT) return redirect(withParam(back, "err", "limit"));
  }
  // One appeal per person. Re-posting edits the note; it does not un-dismiss or bump the appeal.
  await env.DB.prepare(
    `INSERT INTO appeals (from_id, to_handle, note, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(from_id, to_handle) DO UPDATE SET note = excluded.note`,
  )
    .bind(me.id, toLower, note, Date.now())
    .run();
  return redirect(`/@${me.handle}?tab=sent&ok=${existing ? "updated" : "posted"}`);
}

async function withdrawAppeal(env: Env, me: User, id: number): Promise<Response> {
  await env.DB.prepare("DELETE FROM appeals WHERE id = ? AND from_id = ?").bind(id, me.id).run();
  return redirect(`/@${me.handle}?tab=sent&ok=withdrawn`);
}

async function dismissAppeal(env: Env, me: User, id: number): Promise<Response> {
  await env.DB.prepare("UPDATE appeals SET dismissed_at = ? WHERE id = ? AND to_handle = ?")
    .bind(Date.now(), id, me.handle.toLowerCase())
    .run();
  return redirect(`/@${me.handle}?ok=dismissed`);
}

async function search(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase().slice(0, 15);
  if (!q) return Response.json([]);
  const like = q.replace(/_/g, "\\_") + "%";
  // Accounts this site already knows: people who signed in, plus handles someone has appealed to.
  const { results } = await env.DB.prepare(
    `SELECT handle, name, avatar FROM users WHERE handle_lower LIKE ?1 ESCAPE '\\'
     UNION
     SELECT to_handle AS handle, NULL AS name, NULL AS avatar FROM appeals
       WHERE to_handle LIKE ?1 ESCAPE '\\' AND to_handle NOT IN (SELECT handle_lower FROM users)
     ORDER BY handle LIMIT 6`,
  )
    .bind(like)
    .all();
  return Response.json(results, { headers: { "Cache-Control": "private, no-store" } });
}

async function profile(env: Env, url: URL, me: User | null, rawHandle: string): Promise<Response> {
  if (!HANDLE_RE.test(rawHandle)) return html(messagePage("No such page", "X handles are 1–15 letters, numbers or underscores."), 404);
  const lower = rawHandle.toLowerCase();
  const known = await env.DB.prepare("SELECT id, handle, name, avatar FROM users WHERE handle_lower = ? ORDER BY updated_at DESC")
    .bind(lower)
    .first<User>();
  const isOwner = !!me && me.handle.toLowerCase() === lower;
  const tab = isOwner && url.searchParams.get("tab") === "sent" ? "sent" : "received";

  const received = await env.DB.prepare(
    `SELECT a.id, a.note, a.created_at, u.handle, u.name, u.avatar
     FROM appeals a JOIN users u ON u.id = a.from_id
     WHERE a.to_handle = ? AND a.dismissed_at IS NULL ORDER BY a.created_at DESC LIMIT 200`,
  )
    .bind(lower)
    .all<{ id: number; note: string; created_at: number; handle: string; name: string; avatar: string | null }>();

  let sent: { id: number; to_handle: string; note: string; created_at: number; handle: string | null; name: string | null; avatar: string | null }[] = [];
  if (isOwner) {
    sent = (
      await env.DB.prepare(
        `SELECT a.id, a.to_handle, a.note, a.created_at,
                (SELECT handle FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS handle,
                (SELECT name   FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS name,
                (SELECT avatar FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS avatar
         FROM appeals a WHERE a.from_id = ? ORDER BY a.created_at DESC LIMIT 200`,
      )
        .bind(me!.id)
        .all<(typeof sent)[number]>()
    ).results;
  }

  const mine =
    me && !isOwner
      ? await env.DB.prepare("SELECT note, created_at FROM appeals WHERE from_id = ? AND to_handle = ?")
          .bind(me.id, lower)
          .first<{ note: string; created_at: number }>()
      : null;

  return html(
    profilePage({
      me,
      owner: known ?? { id: "", handle: rawHandle, name: "", avatar: null },
      isOwner,
      tab,
      // Notes are private between sender and recipient; everyone else just sees who appealed.
      received: received.results.map((r) => ({ ...r, note: isOwner || (me && r.handle === me.handle) ? r.note : "" })),
      sent,
      mine,
      err: url.searchParams.get("err"),
      ok: url.searchParams.get("ok"),
      path: url.pathname,
    }),
  );
}

// ---------- router ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const secure = url.protocol === "https:";

    if (req.method === "GET" || req.method === "HEAD") {
      if (path === "/auth/login") return loginStart(req, env, url);
      if (path === "/auth/callback") return loginCallback(req, env, url);
      if (path === "/auth/dev") return devLogin(env, url);

      const me = await currentUser(req, env);
      if (path === "/") return html(homePage({ me, err: url.searchParams.get("err") }));
      if (path === "/api/search") return me ? search(env, url) : Response.json([], { status: 401 });
      if (path.startsWith("/@")) return profile(env, url, me, decodeURIComponent(path.slice(2)));
      return html(messagePage("Page not found", "Nothing lives at this address."), 404);
    }

    if (req.method === "POST") {
      // CSRF: cookies are SameSite=Lax, and we additionally require a same-origin Origin header.
      if (req.headers.get("Origin") !== url.origin) return new Response("Bad origin", { status: 403 });
      if (path === "/auth/logout") return redirect("/", [["Set-Cookie", setCookie("s", "", 0, secure)]]);

      const me = await currentUser(req, env);
      if (!me) return redirect("/auth/login");
      if (path === "/appeals") return postAppeal(req, env, me);
      const m = path.match(/^\/appeals\/(\d+)\/(withdraw|dismiss)$/);
      if (m) return m[2] === "withdraw" ? withdrawAppeal(env, me, Number(m[1])) : dismissAppeal(env, me, Number(m[1]));
      return new Response("Not found", { status: 404 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
