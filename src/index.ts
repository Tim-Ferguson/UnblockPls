import { devLogin, loginCallback, loginStart, logout, sessionUserId } from "./auth";
import { type Env, type User, HANDLE_RE, cookies, html, redirect, safeNext, setCookie, withParam } from "./util";
import { type Received, type Sent, type Viewer, homePage, letterAvatar, messagePage, profilePage } from "./views";

const NOTE_MAX = 280;
const DAILY_APPEAL_LIMIT = 20;

// ---------- viewer ----------

async function currentViewer(req: Request, env: Env): Promise<Viewer> {
  const theme = cookies(req).theme;
  const viewer: Viewer = { me: null, pending: 0, theme: theme === "light" || theme === "dark" ? theme : "auto" };
  const uid = await sessionUserId(req, env);
  if (!uid) return viewer;
  // handle_lower is blanked when someone else signs in with this handle; that session is no longer valid.
  viewer.me = await env.DB.prepare("SELECT id, handle, name, avatar, closed FROM users WHERE id = ? AND handle_lower != ''").bind(uid).first<User>();
  if (viewer.me) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM appeals WHERE to_handle = ? AND granted_at IS NULL AND declined_at IS NULL",
    )
      .bind(viewer.me.handle.toLowerCase())
      .first<{ n: number }>();
    viewer.pending = row?.n ?? 0;
  }
  return viewer;
}

// ---------- pages ----------

const SENT_SELECT = `SELECT a.id, a.to_handle, a.note, a.created_at, a.seen_at, a.granted_at, a.declined_at,
  (SELECT handle FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS handle,
  (SELECT name   FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS name,
  (SELECT avatar FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS avatar
  FROM appeals a`;

async function home(env: Env, url: URL, v: Viewer): Promise<Response> {
  const stats = await env.DB.prepare("SELECT COUNT(*) AS total, COUNT(granted_at) AS granted FROM appeals").first<{ total: number; granted: number }>();
  const recent = await env.DB.prepare(
    `SELECT u.handle AS from_handle, u.name AS from_name, u.avatar AS from_avatar, a.to_handle, a.granted_at,
       (SELECT handle FROM users WHERE handle_lower = a.to_handle ORDER BY updated_at DESC LIMIT 1) AS to_known
     FROM appeals a JOIN users u ON u.id = a.from_id
     WHERE a.granted_at IS NOT NULL ORDER BY a.granted_at DESC LIMIT 4`,
  ).all<{ from_handle: string; from_name: string; from_avatar: string | null; to_handle: string; granted_at: number; to_known: string | null }>();
  let sent: Sent[] = [];
  if (v.me) sent = (await env.DB.prepare(`${SENT_SELECT} WHERE a.from_id = ? ORDER BY a.created_at DESC LIMIT 3`).bind(v.me.id).all<Sent>()).results;
  const to = url.searchParams.get("to") ?? "";
  return html(
    homePage({
      v,
      origin: url.origin,
      err: url.searchParams.get("err"),
      to: HANDLE_RE.test(to) ? to : "",
      stats: stats ?? { total: 0, granted: 0 },
      recent: recent.results,
      sent,
    }),
  );
}

async function profile(env: Env, url: URL, v: Viewer, rawHandle: string): Promise<Response> {
  if (!HANDLE_RE.test(rawHandle)) return html(messagePage("No such page", "X handles are 1–15 letters, numbers or underscores.", v), 404);
  const lower = rawHandle.toLowerCase();
  const me = v.me;
  const known = await env.DB.prepare("SELECT id, handle, name, avatar, closed FROM users WHERE handle_lower = ? ORDER BY updated_at DESC")
    .bind(lower)
    .first<User>();
  const isOwner = !!me && me.handle.toLowerCase() === lower;
  const t = url.searchParams.get("tab");
  const tab = isOwner && (t === "granted" || t === "declined" || t === "sent") ? t : "pending";

  const all = (
    await env.DB.prepare(
      `SELECT a.id, a.from_id, a.note, a.created_at, a.seen_at, a.granted_at, a.declined_at, u.handle, u.name, u.avatar
       FROM appeals a JOIN users u ON u.id = a.from_id
       WHERE a.to_handle = ? ORDER BY a.created_at DESC LIMIT 300`,
    )
      .bind(lower)
      .all<Received>()
  ).results;

  let sent: Sent[] = [];
  if (isOwner) {
    sent = (await env.DB.prepare(`${SENT_SELECT} WHERE a.from_id = ? ORDER BY a.created_at DESC LIMIT 300`).bind(me!.id).all<Sent>()).results;
    // Opening your waiting list marks everything on it as seen (the sender's status changes to "Seen").
    if (tab === "pending" && all.some((a) => !a.seen_at)) {
      await env.DB.prepare("UPDATE appeals SET seen_at = ? WHERE to_handle = ? AND seen_at IS NULL").bind(Date.now(), lower).run();
    }
  }

  const mine =
    me && !isOwner
      ? await env.DB.prepare(
          `SELECT a.id, a.from_id, a.note, a.created_at, a.seen_at, a.granted_at, a.declined_at, u.handle, u.name, u.avatar
           FROM appeals a JOIN users u ON u.id = a.from_id WHERE a.from_id = ? AND a.to_handle = ?`,
        )
          .bind(me.id, lower)
          .first<Received>()
      : null;

  return html(
    profilePage({
      v,
      origin: url.origin,
      owner: known ?? { id: "", handle: rawHandle, name: "", avatar: null },
      ownerKnown: !!known,
      isOwner,
      tab,
      // Notes are private between sender and recipient; everyone else just sees who appealed.
      // Declined appeals are only visible to the recipient and the sender.
      received: isOwner ? all : all.filter((a) => !a.declined_at).map((a) => ({ ...a, note: "", seen_at: a.from_id === me?.id ? a.seen_at : null })),
      sent,
      mine,
      err: url.searchParams.get("err"),
      ok: url.searchParams.get("ok"),
      filedTo: HANDLE_RE.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : undefined,
      path: url.pathname,
    }),
  );
}

async function search(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase().slice(0, 15);
  if (!q) return Response.json([]);
  const like = q.replace(/_/g, "\\_") + "%";
  // Accounts this site already knows: people who signed in, plus handles someone has appealed to.
  const { results } = await env.DB.prepare(
    `SELECT handle, name FROM users WHERE handle_lower LIKE ?1 ESCAPE '\\'
     UNION
     SELECT to_handle AS handle, NULL AS name FROM appeals
       WHERE to_handle LIKE ?1 ESCAPE '\\' AND to_handle NOT IN (SELECT handle_lower FROM users)
     ORDER BY handle LIMIT 6`,
  )
    .bind(like)
    .all();
  return Response.json(results, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Profile pictures for any handle, without the X API. Signed-in users have theirs stored from sign-in;
 * for everyone else we ask unavatar.io once and cache the answer at the edge for a week.
 * Falls back to a generated letter avatar, so an <img> pointing here never breaks.
 */
async function avatar(req: Request, env: Env, ctx: ExecutionContext, rawHandle: string): Promise<Response> {
  let handle = rawHandle;
  try {
    handle = decodeURIComponent(rawHandle);
  } catch {}
  if (!HANDLE_RE.test(handle)) return new Response("Not found", { status: 404 });
  const lower = handle.toLowerCase();
  const cache = caches.default;
  const key = new Request(new URL(`/avatar/${lower}`, req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const known = await env.DB.prepare("SELECT id, avatar FROM users WHERE handle_lower = ? ORDER BY updated_at DESC").bind(lower).first<{ id: string; avatar: string | null }>();
  // Only spend an outside lookup on handles that matter: ones with a page here, or typed by a signed-in user.
  const worthLookup =
    !!known ||
    !!(await env.DB.prepare("SELECT 1 FROM appeals WHERE to_handle = ? LIMIT 1").bind(lower).first()) ||
    !!(await sessionUserId(req, env));
  const source = known?.avatar ?? (known?.id.startsWith("dev:") || !worthLookup ? null : `https://unavatar.io/x/${lower}?fallback=false`);
  let res: Response | null = null;
  if (source) {
    try {
      const r = await fetch(source, { signal: AbortSignal.timeout(4000) });
      const type = r.headers.get("Content-Type") ?? "";
      if (r.ok && /^image\/(jpeg|png|webp|gif)/.test(type)) {
        res = new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=604800", "X-Content-Type-Options": "nosniff" } });
      }
    } catch {
      // fall through to the letter avatar
    }
  }
  const found = !!res;
  res ??= new Response(letterAvatar(lower), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": worthLookup ? "public, max-age=3600" : "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
  // A fallback served to an anonymous visitor isn't cached, so a later signed-in lookup can still find the real picture.
  if (found || worthLookup) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- actions ----------

async function fileAppeal(req: Request, env: Env, me: User): Promise<Response> {
  const form = await req.formData();
  const back = safeNext(String(form.get("back") ?? "/"));
  const to = String(form.get("to") ?? "").trim().replace(/^@/, "");
  const note = String(form.get("note") ?? "").replace(/\r\n/g, "\n").trim();
  const fail = (code: string) => redirect(withParam(HANDLE_RE.test(to) && back === "/" ? `/?to=${to}` : back, "err", code));
  if (!HANDLE_RE.test(to)) return fail("handle");
  if (to.toLowerCase() === me.handle.toLowerCase()) return fail("self");
  if ([...note].length > NOTE_MAX) return fail("long");

  const toLower = to.toLowerCase();
  const target = await env.DB.prepare("SELECT closed FROM users WHERE handle_lower = ? ORDER BY updated_at DESC").bind(toLower).first<{ closed: number }>();
  if (target?.closed) return fail("closed");

  const existing = await env.DB.prepare("SELECT id, granted_at, declined_at FROM appeals WHERE from_id = ? AND to_handle = ?")
    .bind(me.id, toLower)
    .first<{ id: number; granted_at: number | null; declined_at: number | null }>();
  if (existing) {
    // One appeal per person. While it's pending you can edit the note; once it's decided, that's the answer.
    if (existing.granted_at || existing.declined_at) return fail("decided");
    await env.DB.prepare("UPDATE appeals SET note = ? WHERE id = ?").bind(note, existing.id).run();
    return redirect(`/@${me.handle}?tab=sent&ok=updated`);
  }
  if (await env.DB.prepare("SELECT 1 FROM declines WHERE from_id = ? AND to_handle = ?").bind(me.id, toLower).first()) return fail("decided");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM appeals WHERE from_id = ? AND created_at > ?")
    .bind(me.id, Date.now() - 86400_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= DAILY_APPEAL_LIMIT) return fail("limit");
  await env.DB.prepare("INSERT INTO appeals (from_id, to_handle, note, created_at) VALUES (?, ?, ?, ?)").bind(me.id, toLower, note, Date.now()).run();
  return redirect(`/@${me.handle}?tab=sent&ok=filed&to=${toLower}`);
}

async function appealAction(req: Request, env: Env, me: User, id: number, action: string): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const back = safeNext(String(form?.get("back") ?? `/@${me.handle}`));
  const mine = me.handle.toLowerCase();
  const now = Date.now();
  if (action === "withdraw") {
    // Only an unanswered appeal can be withdrawn. Once it's granted or declined it stays on record,
    // otherwise withdrawing and re-filing would get around the answer.
    const r = await env.DB.prepare("DELETE FROM appeals WHERE id = ? AND from_id = ? AND declined_at IS NULL AND granted_at IS NULL").bind(id, me.id).run();
    return redirect(r.meta.changes ? withParam(back, "ok", "withdrawn") : back);
  }
  // The remaining actions belong to the recipient only.
  const sql =
    action === "grant"
      ? "UPDATE appeals SET granted_at = ?1, declined_at = NULL, seen_at = COALESCE(seen_at, ?1) WHERE id = ?2 AND to_handle = ?3"
      : action === "decline"
        ? "UPDATE appeals SET declined_at = ?1, granted_at = NULL, seen_at = COALESCE(seen_at, ?1) WHERE id = ?2 AND to_handle = ?3"
        : "UPDATE appeals SET granted_at = NULL, declined_at = NULL, seen_at = COALESCE(seen_at, ?1) WHERE id = ?2 AND to_handle = ?3";
  const r = await env.DB.prepare(sql).bind(now, id, mine).run();
  if (!r.meta.changes) return redirect(back);
  return redirect(withParam(back, "ok", action === "grant" ? "granted" : action === "decline" ? "declined" : "reopened"));
}

async function settings(req: Request, env: Env, me: User): Promise<Response> {
  const form = await req.formData();
  const closed = form.get("closed") === "1" ? 1 : 0;
  await env.DB.prepare("UPDATE users SET closed = ? WHERE id = ?").bind(closed, me.id).run();
  return redirect(`/@${me.handle}?ok=${closed ? "closed" : "opened"}`);
}

async function deleteAccount(env: Env, me: User, secure: boolean): Promise<Response> {
  await env.DB.batch([
    // Keep a note-free record of declines so deleting and re-joining can't reopen them.
    env.DB.prepare("INSERT OR IGNORE INTO declines (from_id, to_handle, declined_at) SELECT from_id, to_handle, declined_at FROM appeals WHERE from_id = ? AND declined_at IS NOT NULL").bind(me.id),
    env.DB.prepare("DELETE FROM appeals WHERE from_id = ?").bind(me.id),
    env.DB.prepare("DELETE FROM appeals WHERE to_handle = ?").bind(me.handle.toLowerCase()),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(me.id),
  ]);
  return logout(secure);
}

// ---------- router ----------

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const secure = url.protocol === "https:";
    // Never run with unsigned sessions: refuse everything until the signing secret is configured.
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) return new Response("Not configured", { status: 503 });

    if (req.method === "GET" || req.method === "HEAD") {
      if (path === "/auth/login") return loginStart(env, url);
      if (path === "/auth/callback") return loginCallback(req, env, url);
      if (path === "/auth/dev") return devLogin(env, url);
      if (path.startsWith("/avatar/")) return avatar(req, env, ctx, path.slice(8));
      if (path === "/theme") {
        const set = url.searchParams.get("set");
        const value = set === "light" || set === "dark" ? set : "";
        return redirect(safeNext(url.searchParams.get("next")), [["Set-Cookie", setCookie("theme", value, value ? 31536000 : 0, secure)]]);
      }

      const v = await currentViewer(req, env);
      if (path === "/") return home(env, url, v);
      if (path === "/api/search") return v.me ? search(env, url) : Response.json([], { status: 401 });
      if (path.startsWith("/@")) {
        let handle = path.slice(2);
        try {
          handle = decodeURIComponent(handle);
        } catch {}
        return profile(env, url, v, handle);
      }
      return html(messagePage("Page not found", "Nothing lives at this address.", v), 404);
    }

    if (req.method === "POST") {
      // CSRF: cookies are SameSite=Lax, and we additionally require a same-origin Origin header.
      if (req.headers.get("Origin") !== url.origin) return new Response("Bad origin", { status: 403 });
      if (path === "/auth/logout") return logout(secure);

      const { me } = await currentViewer(req, env);
      if (!me) return redirect("/auth/login");
      if (path === "/appeals") return fileAppeal(req, env, me);
      if (path === "/settings") return settings(req, env, me);
      if (path === "/account/delete") return deleteAccount(env, me, secure);
      const m = path.match(/^\/appeals\/(\d+)\/(withdraw|grant|decline|reopen)$/);
      if (m) return appealAction(req, env, me, Number(m[1]), m[2]!);
      return new Response("Not found", { status: 404 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
