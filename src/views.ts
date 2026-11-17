export interface User {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function avatar(u: { handle: string; avatar: string | null }, size = ""): string {
  return u.avatar
    ? `<img class="av ${size}" src="${esc(u.avatar)}" alt="" loading="lazy">`
    : `<span class="av ${size} av-letter" aria-hidden="true">${esc(u.handle[0]!.toUpperCase())}</span>`;
}

const X_LOGO = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;

const ERRORS: Record<string, string> = {
  handle: "That isn't a valid X handle. Handles are 1–15 letters, numbers or underscores.",
  self: "You can't appeal to yourself.",
  long: "Notes can be up to 280 characters.",
  limit: "You've posted 20 appeals in the last 24 hours. Try again tomorrow.",
};

const OKS: Record<string, string> = {
  posted: "Appeal posted.",
  updated: "Note updated.",
  withdrawn: "Appeal withdrawn.",
  dismissed: "Appeal dismissed.",
};

function banner(err: string | null, ok: string | null = null): string {
  if (err && ERRORS[err]) return `<p class="banner err" role="alert">${esc(ERRORS[err])}</p>`;
  if (ok && OKS[ok]) return `<p class="banner ok" role="status">${esc(OKS[ok])}</p>`;
  return "";
}

function loginButton(next: string, label = "Sign in with X"): string {
  return `<a class="btn" href="/auth/login?next=${encodeURIComponent(next)}">${X_LOGO}<span>${esc(label)}</span></a>`;
}

function layout(title: string, me: User | null, body: string, path = "/"): string {
  const nav = me
    ? `<a class="me" href="/@${esc(me.handle)}">${avatar(me, "sm")}<span>@${esc(me.handle)}</span></a>
       <form method="post" action="/auth/logout"><button class="link">Sign out</button></form>`
    : `<a class="link" href="/auth/login?next=${encodeURIComponent(path)}">Sign in</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Ask someone on X to unblock you. They see who asked on their Unblock page.">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top"><a class="logo" href="/">Unblock</a><nav>${nav}</nav></header>
<main>${body}</main>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function appealForm(opts: { to?: string; note?: string; back: string; editing?: boolean }): string {
  const toField = opts.to
    ? `<input type="hidden" name="to" value="${esc(opts.to)}">`
    : `<label for="to">Who blocked you?</label>
       <div class="handle-field">
         <span>@</span>
         <input id="to" name="to" required maxlength="16" pattern="@?[A-Za-z0-9_]{1,15}" placeholder="their X handle"
                autocomplete="off" autocapitalize="off" spellcheck="false" data-suggest>
       </div>
       <ul class="suggest" hidden></ul>`;
  return `<form method="post" action="/appeals" class="card form">
    <input type="hidden" name="back" value="${esc(opts.back)}">
    ${toField}
    <label for="note">Note <span class="muted">(optional, only they can read it)</span></label>
    <textarea id="note" name="note" rows="3" maxlength="280" placeholder="Sorry about the reply-guy thing. I'll be normal." data-count>${esc(opts.note ?? "")}</textarea>
    <div class="form-foot">
      <span class="muted count" aria-live="polite"></span>
      <button class="btn">${opts.editing ? "Update note" : "Post appeal"}</button>
    </div>
  </form>`;
}

export function homePage(p: { me: User | null; err: string | null }): string {
  const { me } = p;
  const body = me
    ? `<section class="hero compact">
         <h1>Ask to be unblocked</h1>
         <p class="lede">Your appeal shows up on their Unblock page. Nothing is posted to X.</p>
       </section>
       ${banner(p.err)}
       ${appealForm({ back: "/" })}
       <p class="center"><a href="/@${esc(me.handle)}">Appeals to you</a> · <a href="/@${esc(me.handle)}?tab=sent">Appeals you've sent</a></p>`
    : `<section class="hero">
         <h1>Blocked on X?<br>Ask nicely.</h1>
         <p class="lede">Post an unblock appeal to someone who blocked you, with a short apology if you owe one. They see it on their page and can unblock you in two clicks.</p>
         ${loginButton("/")}
         <p class="muted small">Read-only sign-in. Unblock can't post, follow or DM for you.</p>
       </section>
       <ol class="steps">
         <li><b>Sign in with X</b> so they know the appeal is really from you.</li>
         <li><b>Enter their handle</b> and add a note of up to 280 characters.</li>
         <li><b>They open their page</b> at unblock.timo.gg/@theirhandle and decide.</li>
       </ol>
       <form class="card lookup" method="get" action="/" data-lookup>
         <label for="lookup">See who wants you to unblock them</label>
         <div class="row">
           <div class="handle-field"><span>@</span><input id="lookup" required pattern="@?[A-Za-z0-9_]{1,15}" placeholder="your X handle" autocapitalize="off" spellcheck="false"></div>
           <button class="btn secondary">View page</button>
         </div>
       </form>`;
  return layout("Unblock: ask someone on X to unblock you", me, body);
}

interface Received {
  id: number;
  note: string;
  created_at: number;
  handle: string;
  name: string;
  avatar: string | null;
}
interface Sent {
  id: number;
  to_handle: string;
  note: string;
  created_at: number;
  handle: string | null;
  name: string | null;
  avatar: string | null;
}

export function profilePage(p: {
  me: User | null;
  owner: User;
  isOwner: boolean;
  tab: "received" | "sent";
  received: Received[];
  sent: Sent[];
  mine: { note: string; created_at: number } | null;
  err: string | null;
  ok: string | null;
  path: string;
}): string {
  const { me, owner, isOwner } = p;
  const h = esc(owner.handle);
  const n = p.received.length;

  const receivedList = n
    ? `<ul class="list">${p.received
        .map(
          (r) => `<li class="item">
            ${avatar(r)}
            <div class="who">
              <div class="names"><b>${esc(r.name)}</b> <span class="muted">@${esc(r.handle)} · ${ago(r.created_at)}</span></div>
              ${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}
            </div>
            <div class="actions">
              <a class="btn small" href="https://x.com/${esc(r.handle)}" target="_blank" rel="noopener">${isOwner ? "Unblock on X" : "View on X"}</a>
              ${isOwner ? `<form method="post" action="/appeals/${r.id}/dismiss"><button class="link">Dismiss</button></form>` : ""}
            </div>
          </li>`,
        )
        .join("")}</ul>`
    : `<p class="empty">${isOwner ? "Nobody has asked you to unblock them." : `Nobody has appealed to @${h} yet.`}</p>`;

  const sentList = p.sent.length
    ? `<ul class="list">${p.sent
        .map((s) => {
          const handle = s.handle ?? s.to_handle;
          return `<li class="item">
            ${avatar({ handle, avatar: s.avatar })}
            <div class="who">
              <div class="names"><a href="/@${esc(handle)}"><b>${esc(s.name || "@" + handle)}</b></a> <span class="muted">${s.name ? `@${esc(handle)} · ` : ""}${ago(s.created_at)}</span></div>
              ${s.note ? `<p class="note">${esc(s.note)}</p>` : `<p class="note muted">No note.</p>`}
            </div>
            <div class="actions">
              <form method="post" action="/appeals/${s.id}/withdraw" data-confirm="Withdraw your appeal to @${esc(handle)}?"><button class="link">Withdraw</button></form>
            </div>
          </li>`;
        })
        .join("")}</ul>`
    : `<p class="empty">You haven't sent any appeals. <a href="/">Post one</a>.</p>`;

  let side = "";
  if (isOwner) {
    side = "";
  } else if (me) {
    side = `<section class="compose">
      <h2>${p.mine ? `You appealed to @${h} ${ago(p.mine.created_at)}` : `Ask @${h} to unblock you`}</h2>
      ${appealForm({ to: owner.handle, note: p.mine?.note, back: p.path, editing: !!p.mine })}
    </section>`;
  } else {
    side = `<section class="compose card cta">
      <p><b>Did @${h} block you?</b> Sign in to post an appeal on this page.</p>
      ${loginButton(p.path)}
      <p class="muted small">Are you @${h}? Sign in to read the notes people left.</p>
    </section>`;
  }

  const tabs = isOwner
    ? `<nav class="tabs">
         <a href="/@${h}" ${p.tab === "received" ? 'aria-current="page"' : ""}>To you <span class="pill">${n}</span></a>
         <a href="/@${h}?tab=sent" ${p.tab === "sent" ? 'aria-current="page"' : ""}>Sent <span class="pill">${p.sent.length}</span></a>
         <a class="btn small new" href="/">New appeal</a>
       </nav>`
    : "";

  const summary = isOwner
    ? p.tab === "sent"
      ? `You've sent ${plural(p.sent.length, "appeal", "appeals")}.`
      : n
        ? `${plural(n, "person wants", "people want")} you to unblock them. Open their profile on X and choose Unblock.`
        : ""
    : n
      ? `${plural(n, "person has", "people have")} asked @${h} to unblock them.`
      : "";

  const body = `<section class="profile">
      ${avatar(owner, "lg")}
      <div>
        <h1>${owner.name ? esc(owner.name) : `@${h}`}</h1>
        <p class="muted">${owner.name ? `@${h} · ` : ""}<a href="https://x.com/${h}" target="_blank" rel="noopener">x.com/${h}</a></p>
      </div>
    </section>
    ${banner(p.err, p.ok)}
    ${tabs}
    ${summary ? `<p class="summary">${summary}</p>` : ""}
    ${p.tab === "sent" ? sentList : receivedList}
    ${side}`;
  return layout(`Unblock appeals to @${owner.handle}`, me, body, p.path);
}

export function messagePage(title: string, text: string, extraHtml = ""): string {
  return layout(title, null, `<section class="hero compact"><h1>${esc(title)}</h1><p class="lede">${esc(text)}</p>${extraHtml}<p><a href="/">Back to Unblock</a></p></section>`);
}
