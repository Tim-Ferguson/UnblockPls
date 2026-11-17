import type { User } from "./util";

export interface Viewer {
  me: User | null;
  /** Appeals waiting on the signed-in user. */
  pending: number;
  theme: "auto" | "light" | "dark";
}

interface AppealState {
  id: number;
  note: string;
  created_at: number;
  seen_at: number | null;
  granted_at: number | null;
  declined_at: number | null;
}
/** An appeal as its recipient sees it: handle/name/avatar belong to the sender. */
export interface Received extends AppealState {
  from_id: string;
  handle: string;
  name: string;
  avatar: string | null;
}
/** An appeal as its sender sees it: handle/name/avatar belong to the recipient, when they've signed in. */
export interface Sent extends AppealState {
  to_handle: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
}

type Status = "pending" | "seen" | "granted" | "declined";

// ---------- helpers ----------

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

const statusOf = (a: AppealState): Status => (a.granted_at ? "granted" : a.declined_at ? "declined" : a.seen_at ? "seen" : "pending");
const caseNo = (id: number): string => `#${String(id).padStart(4, "0")}`;

/** Every profile picture goes through /avatar/:handle, which caches it and falls back to a letter. */
function av(handle: string, _avatar: string | null, cls = ""): string {
  return `<img class="av ${cls}" src="/avatar/${esc(handle.toLowerCase())}" alt="" width="48" height="48" loading="lazy">`;
}

const AVATAR_COLORS = ["#c5341f", "#1c7a4c", "#2a48c7", "#9a6a00", "#7a3fb0", "#0f7c86", "#b0356f"];

/** Fallback profile picture: the handle's first letter on a colour picked from the handle. */
export function letterAvatar(handle: string): string {
  let h = 2166136261; // FNV-1a, so similar handles still land on different colours
  for (const c of handle) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const letter = (handle.replace(/^_+/, "")[0] ?? "?").toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${AVATAR_COLORS[h % AVATAR_COLORS.length]}"/><text x="48" y="50" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif" font-size="46" font-weight="700" fill="#fffdf8">${esc(letter)}</text></svg>`;
}

const ICON = {
  x: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  out: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 11 11 5M6 5h5v5"/></svg>`,
  copy: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M5.5 5.5v-3h8v8h-3M2.5 5.5h8v8h-8z"/></svg>`,
};

const STAMP_LABEL: Record<Status, string> = { pending: "Pending", seen: "Seen", granted: "Granted", declined: "Declined" };
const stamp = (s: Status, cls = ""): string => `<span class="stamp s-${s} ${cls}">${STAMP_LABEL[s]}</span>`;

const ERRORS: Record<string, string> = {
  handle: "That isn't a valid X handle. Handles are 1–15 letters, numbers or underscores.",
  self: "You can't appeal to yourself.",
  long: "Notes can be up to 280 characters.",
  limit: "You've filed 20 appeals in the last 24 hours. Try again tomorrow.",
  closed: "That person has turned off appeals.",
  decided: "They've already answered that appeal, so it can't be changed.",
};

const OKS: Record<string, string> = {
  updated: "Note updated.",
  withdrawn: "Appeal withdrawn.",
  granted: "Marked as granted. They'll see it on their page.",
  declined: "Declined. It's off your list.",
  reopened: "Moved back to pending.",
  closed: "Appeals are off. Nobody new can appeal to you.",
  opened: "Appeals are back on.",
};

function banner(err: string | null, ok: string | null = null): string {
  if (err && ERRORS[err]) return `<p class="banner err" role="alert">${esc(ERRORS[err])}</p>`;
  if (ok && OKS[ok]) return `<p class="banner ok" role="status">${esc(OKS[ok])}</p>`;
  return "";
}

function signInButton(next: string, label = "Sign in with X", cls = "primary"): string {
  return `<a class="btn ${cls}" href="/auth/login?next=${encodeURIComponent(next)}">${ICON.x}<span>${esc(label)}</span></a>`;
}

function copyButton(text: string, label: string, cls = ""): string {
  return `<button type="button" class="btn small ${cls}" data-copy="${esc(text)}">${ICON.copy}<span>${esc(label)}</span></button>`;
}

const host = (origin: string): string => origin.replace(/^https?:\/\//, "");

// ---------- shell ----------

function layout(o: { title: string; desc?: string; v: Viewer; body: string; path?: string; origin?: string; }): string {
  const { v } = o;
  const path = o.path ?? "/";
  const desc = o.desc ?? "Blocked on X? Sign in, name who blocked you and leave a short note. They see it on their page and can unblock you.";
  const nav = v.me
    ? `<a class="navlink" href="/"><span class="plus" aria-hidden="true">+</span> <span class="navlink-long">File an appeal</span><span class="navlink-short">Appeal</span></a>
       <a class="me" href="/@${esc(v.me.handle)}" title="Your page">${av(v.me.handle, v.me.avatar, "sm")}<span class="me-handle">@${esc(v.me.handle)}</span>${
         v.pending ? `<span class="badge" title="${plural(v.pending, "appeal is", "appeals are")} waiting on you">${v.pending}</span>` : ""
       }</a>`
    : `<a class="btn small ghost" href="/auth/login?next=${encodeURIComponent(path)}">${ICON.x}<span>Sign in</span></a>`;
  const themeLink = (t: string, label: string) =>
    `<a href="/theme?set=${t}&amp;next=${encodeURIComponent(path)}" ${v.theme === t ? 'aria-current="true"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en"${v.theme === "auto" ? "" : ` data-theme="${v.theme}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
${o.origin ? `<meta property="og:image" content="${esc(o.origin)}/og.png">\n<meta name="twitter:card" content="summary_large_image">` : ""}
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg">
<link rel="preload" href="/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top wrap"><a class="brand" href="/">Unblock<i>pls</i></a><nav>${nav}</nav></header>
<main class="wrap">${o.body}</main>
<footer class="foot wrap">
  <span>Not affiliated with X Corp. Nothing here posts to X.</span>
  <span class="theme">Theme: ${themeLink("auto", "Auto")} ${themeLink("light", "Light")} ${themeLink("dark", "Dark")}</span>
  ${v.me ? `<form method="post" action="/auth/logout"><button class="linkbtn">Sign out</button></form>` : ""}
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

// ---------- appeal form ----------

const STARTERS: [string, string][] = [
  ["I was wrong", "I was wrong, and I was loud about it. I'm sorry."],
  ["I was annoying", "I replied to everything you posted for a month. I've stopped. Sorry."],
  ["It was a joke", "It was meant as a joke and it didn't land. Sorry about that."],
  ["No idea what I did", "I honestly don't know what I did, but I'd like to put it right."],
];

function appealForm(o: { to?: string; lockTo?: boolean; note?: string; back: string; editing?: boolean }): string {
  const toField = o.lockTo
    ? `<input type="hidden" name="to" value="${esc(o.to)}">`
    : `<div class="field">
         <label for="to">Who blocked you?</label>
         <div class="handle-field">
           <span aria-hidden="true">@</span>
           <input id="to" name="to" required maxlength="16" pattern="@?[A-Za-z0-9_]{1,15}" placeholder="their X handle" value="${esc(o.to ?? "")}"
                  autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-suggest>
         </div>
         <ul class="suggest" hidden></ul>
         <a class="check" data-check hidden target="_blank" rel="noopener"></a>
       </div>`;
  return `<form method="post" action="/appeals" class="file">
    <input type="hidden" name="back" value="${esc(o.back)}">
    ${toField}
    <div class="field">
      <label for="note">Your note <span class="opt">optional · only they can read it</span></label>
      ${
        o.editing
          ? ""
          : `<div class="chips" role="group" aria-label="Note starters">${STARTERS.map(([label, text]) => `<button type="button" class="chip" data-fill="${esc(text)}">${esc(label)}</button>`).join("")}</div>`
      }
      <textarea id="note" name="note" rows="4" maxlength="280" placeholder="Say what happened and that you're sorry." data-count>${esc(o.note ?? "")}</textarea>
    </div>
    <div class="file-foot">
      <span class="count" aria-live="polite"></span>
      <button class="btn primary">${o.editing ? "Save note" : "File appeal"}</button>
    </div>
    ${o.editing ? "" : `<p class="fine">Your name is listed publicly on their page. Only they can read the note.</p>`}
  </form>`;
}

// ---------- home ----------

function sampleCard(o: { no: string; name: string; handle: string; note: string; status: Status; when: string; cls: string }): string {
  return `<article class="appeal sample ${o.cls}">
    <header class="appeal-meta"><span>Appeal ${o.no}</span><span>${o.when}</span>${stamp(o.status, "big")}</header>
    <div class="appeal-body">
      <span class="av letter ${o.cls}">${o.name[0]}</span>
      <div class="appeal-main">
        <p class="names"><b>${o.name}</b> <span>@${o.handle}</span></p>
        <p class="note">${o.note}</p>
      </div>
    </div>
  </article>`;
}

export function homePage(p: {
  v: Viewer;
  origin: string;
  err: string | null;
  to: string;
  stats: { total: number; granted: number };
  recent: { from_handle: string; from_name: string; from_avatar: string | null; to_handle: string; granted_at: number; to_known: string | null }[];
  sent: Sent[];
}): string {
  const { v } = p;
  const me = v.me;
  const site = host(p.origin);

  const feed = p.recent.length
    ? `<section class="feed">
         <div class="section-head">
           <h2>Recently granted</h2>
           <p class="tally"><b>${p.stats.total}</b> ${p.stats.total === 1 ? "appeal" : "appeals"} filed · <b>${p.stats.granted}</b> granted</p>
         </div>
         <ul class="feed-list">${p.recent
           .map((r) => {
             const to = r.to_known ?? r.to_handle;
             return `<li>
               <span class="pair">${av(to, null, "sm")}${av(r.from_handle, r.from_avatar, "sm")}</span>
               <span class="feed-text"><a href="/@${esc(to)}">@${esc(to)}</a> unblocked <b>@${esc(r.from_handle)}</b></span>
               <span class="feed-when">${ago(r.granted_at)}</span>
             </li>`;
           })
           .join("")}</ul>
       </section>`
    : "";

  if (me) {
    const recentSent = p.sent.length
      ? `<section class="recent">
           <div class="section-head"><h2>Your latest appeals</h2><a href="/@${esc(me.handle)}?tab=sent">See all</a></div>
           <ul class="mini-list">${p.sent
             .map((s) => {
               const h = s.handle ?? s.to_handle;
               return `<li><a href="/@${esc(h)}">${av(h, s.avatar, "sm")}<span class="mini-name">${esc(s.name || "@" + h)}</span></a><span class="mini-when">${ago(s.created_at)}</span>${stamp(statusOf(s), "flat")}</li>`;
             })
             .join("")}</ul>
         </section>`
      : "";
    const waiting = v.pending
      ? `<a class="callout" href="/@${esc(me.handle)}"><b>${plural(v.pending, "person is", "people are")} waiting on you.</b> <span>Review ${v.pending === 1 ? "their appeal" : "their appeals"} ${ICON.out}</span></a>`
      : "";
    const body = `<div class="desk">
        <div class="desk-head">
          <h1>File an appeal</h1>
          <p class="lede">It goes on their Unblockpls page. Nothing is posted to X, and X won't notify them.</p>
          ${banner(p.err)}
        </div>
        <aside class="desk-preview" aria-label="Preview">
          <p class="label">What <span data-pv-to>${p.to ? "@" + esc(p.to) : "they"}</span> will see</p>
          <article class="appeal preview">
            <header class="appeal-meta"><span>Appeal #····</span><span>just now</span>${stamp("pending")}</header>
            <div class="appeal-body">
              ${av(me.handle, me.avatar)}
              <div class="appeal-main">
                <p class="names"><b>${esc(me.name)}</b> <span>@${esc(me.handle)}</span></p>
                <p class="note" data-pv-note data-empty="Your note shows up here as you type."></p>
              </div>
            </div>
          </article>
          <ol class="next">
            <li><span><b>It's listed</b> at ${esc(site)}/@<span data-pv-handle>${esc(p.to || "theirhandle")}</span>. Your name is public, your note isn't.</span></li>
            <li><span><b>Seen</b> appears on your appeal once they open their page.</span></li>
            <li><span><b>Granted</b> or <b>Declined</b> shows up when they answer.</span></li>
          </ol>
        </aside>
        <div class="desk-form">${appealForm({ to: p.to, back: "/" })}</div>
      </div>
      ${waiting}
      ${recentSent}
      ${feed}`;
    return layout({ title: "File an appeal · Unblockpls", v, body, origin: p.origin });
  }

  const body = `<section class="hero">
      <div class="hero-copy">
        <h1>Blocked on X?<br><em>File an appeal.</em></h1>
        <p class="lede">Name the person who blocked you and leave a note of up to 280 characters. It waits on their page until they grant it, decline it, or never look.</p>
        <div class="cta-row">
          ${signInButton("/")}
          <span class="fine">Read-only sign-in. Unblockpls can't post, follow or DM for you.</span>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        ${sampleCard({ no: "#0041", name: "Theo", handle: "replyguy_theo", note: "I said “well, actually” eleven times in one thread. Twelve, counting this.", status: "pending", when: "2h ago", cls: "c1" })}
        ${sampleCard({ no: "#0038", name: "Dana", handle: "dana_was_wrong", note: "I corrected your grammar under a post about your grandmother. I’m sorry.", status: "granted", when: "3d ago", cls: "c2" })}
        ${sampleCard({ no: "#0035", name: "Marcus", handle: "marcus_ratio", note: "unblock me or else", status: "declined", when: "6d ago", cls: "c3" })}
      </div>
    </section>

    <section class="steps">
      <div class="step"><span class="num">1</span><h3>Sign in with X</h3><p>So they know the appeal is really from you.</p></div>
      <div class="step"><span class="num">2</span><h3>Name who blocked you</h3><p>Add an apology if you owe one. Only they can read it.</p></div>
      <div class="step"><span class="num">3</span><h3>They decide</h3><p>On their page they open your profile, unblock you, and mark it granted. Or decline.</p></div>
    </section>

    <section class="lookup">
      <div>
        <h2>Did you block someone?</h2>
        <p>See who's asking you to reconsider.</p>
      </div>
      <form method="get" action="/" data-lookup>
        <div class="handle-field"><span aria-hidden="true">@</span><input aria-label="Your X handle" required pattern="@?[A-Za-z0-9_]{1,15}" placeholder="your X handle" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <button class="btn invert">Open my page</button>
      </form>
    </section>
    ${feed}`;
  return layout({ title: "Unblockpls: ask someone on X to unblock you", v, body, origin: p.origin });
}

// ---------- profile ----------

function receivedCard(a: Received, o: { isOwner: boolean; back: string; isNew: boolean; yours?: boolean }): string {
  const st = statusOf(a);
  const shown: Status = o.yours ? st : o.isOwner ? (st === "seen" ? "pending" : st) : st === "granted" ? "granted" : "pending";
  const act = (action: string, label: string, cls: string) =>
    `<form method="post" action="/appeals/${a.id}/${action}"><input type="hidden" name="back" value="${esc(o.back)}"><button class="btn small ${cls}">${label}</button></form>`;
  let actions = "";
  if (o.isOwner) {
    const open = `<a class="btn small ${st === "granted" || st === "declined" ? "ghost" : "primary"}" href="https://x.com/${esc(a.handle)}" target="_blank" rel="noopener">Open @${esc(a.handle)} on X ${ICON.out}</a>`;
    actions =
      st === "granted" || st === "declined"
        ? `<footer class="appeal-actions">${open}${act("reopen", "Move back to pending", "ghost")}</footer>`
        : `<footer class="appeal-actions">${open}${act("grant", "Mark granted", "ghost grant")}${act("decline", "Decline", "ghost")}</footer>`;
  }
  if (!o.isOwner) {
    return `<li><article class="appeal row ${shown}">
      <a href="/@${esc(a.handle)}" tabindex="-1" aria-hidden="true">${av(a.handle, a.avatar)}</a>
      <p class="names"><a href="/@${esc(a.handle)}"><b>${esc(a.name)}</b></a> <span>@${esc(a.handle)}</span>${o.yours ? ` <span class="you">You</span>` : ""}</p>
      <span class="row-when">${st === "granted" ? `granted ${ago(a.granted_at!)}` : ago(a.created_at)}</span>
      ${stamp(shown)}
    </article></li>`;
  }
  const when = st === "granted" ? `granted ${ago(a.granted_at!)}` : st === "declined" && o.isOwner ? `declined ${ago(a.declined_at!)}` : ago(a.created_at);
  return `<li><article class="appeal ${shown}">
    <header class="appeal-meta"><span>Appeal ${caseNo(a.id)}</span><span>${when}</span>${o.isNew ? `<span class="new">New</span>` : ""}${stamp(shown)}</header>
    <div class="appeal-body">
      <a href="/@${esc(a.handle)}" tabindex="-1" aria-hidden="true">${av(a.handle, a.avatar)}</a>
      <div class="appeal-main">
        <p class="names"><a href="/@${esc(a.handle)}"><b>${esc(a.name)}</b></a> <span>@${esc(a.handle)}</span></p>
        ${a.note ? `<p class="note">${esc(a.note)}</p>` : o.isOwner ? `<p class="note none">No note.</p>` : ""}
      </div>
    </div>
    ${actions}
  </article></li>`;
}

function sentCard(s: Sent, o: { back: string; origin: string }): string {
  const st = statusOf(s);
  const h = s.handle ?? s.to_handle;
  const line: Record<Status, string> = {
    pending: s.handle ? "They haven't opened their page since you filed." : `@${esc(h)} hasn't signed in to Unblockpls yet.`,
    seen: `Seen ${ago(s.seen_at ?? s.created_at)}. No answer yet.`,
    granted: `Granted ${ago(s.granted_at ?? s.created_at)}. Check X: you should be unblocked.`,
    declined: `Declined ${ago(s.declined_at ?? s.created_at)}.`,
  };
  return `<li><article class="appeal ${st}">
    <header class="appeal-meta"><span>Appeal ${caseNo(s.id)}</span><span>filed ${ago(s.created_at)}</span>${stamp(st)}</header>
    <div class="appeal-body">
      <a href="/@${esc(h)}" tabindex="-1" aria-hidden="true">${av(h, s.avatar)}</a>
      <div class="appeal-main">
        <p class="names"><span class="to">To</span> <a href="/@${esc(h)}"><b>${esc(s.name || "@" + h)}</b></a>${s.name ? ` <span>@${esc(h)}</span>` : ""}</p>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : `<p class="note none">No note.</p>`}
        <p class="status-line">${line[st]}</p>
      </div>
    </div>
    <footer class="appeal-actions">
      ${st === "pending" || st === "seen" ? copyButton(`${o.origin}/@${h}`, "Copy link to their page", "ghost") : ""}
      ${
        st === "pending" || st === "seen"
          ? `<form method="post" action="/appeals/${s.id}/withdraw" data-confirm="Withdraw your appeal to @${esc(h)}?"><input type="hidden" name="back" value="${esc(o.back)}"><button class="btn small ghost">Withdraw</button></form>`
          : ""
      }
    </footer>
  </article></li>`;
}

export function profilePage(p: {
  v: Viewer;
  origin: string;
  owner: User;
  ownerKnown: boolean;
  isOwner: boolean;
  tab: "pending" | "granted" | "declined" | "sent";
  received: Received[];
  sent: Sent[];
  mine: Received | null;
  err: string | null;
  ok: string | null;
  filedTo?: string;
  path: string;
}): string {
  const { v, owner, isOwner } = p;
  const me = v.me;
  const h = esc(owner.handle);
  const pageUrl = `${p.origin}/@${owner.handle}`;
  const closed = !!owner.closed;

  const pending = p.received.filter((a) => !a.granted_at && !a.declined_at);
  const granted = p.received.filter((a) => a.granted_at);
  const declined = p.received.filter((a) => a.declined_at);
  const back = p.tab === "pending" ? p.path : `${p.path}?tab=${p.tab}`;

  // --- list ---
  let list: string;
  const empty = (title: string, text: string, extra = "") => `<div class="empty"><h3>${title}</h3><p>${text}</p>${extra}</div>`;
  if (!isOwner && closed) {
    list = empty(`@${h} isn't taking appeals`, "They've turned appeals off for their page.");
  } else if (isOwner && p.tab === "sent") {
    list = p.sent.length
      ? `<ul class="appeals">${p.sent.map((s) => sentCard(s, { back, origin: p.origin })).join("")}</ul>`
      : empty("You haven't filed any appeals", "Blocked by someone? Ask them to reconsider.", `<a class="btn primary" href="/">File an appeal</a>`);
  } else if (isOwner) {
    const rows = p.tab === "granted" ? granted : p.tab === "declined" ? declined : pending;
    const hint =
      p.tab === "pending" && rows.length
        ? `<p class="hint"><b>How to grant one:</b> open their profile on X, choose Unblock, then mark it granted here so they know.</p>`
        : "";
    list = rows.length
      ? `${hint}<ul class="appeals">${rows.map((a) => receivedCard(a, { isOwner: true, back, isNew: p.tab === "pending" && !a.seen_at })).join("")}</ul>`
      : p.tab === "pending"
        ? empty("No pending appeals", "When someone you blocked files an appeal, it shows up here.", copyButton(pageUrl, "Copy your page link", "ghost"))
        : p.tab === "granted"
          ? empty("Nothing granted yet", "Appeals you mark granted are kept here.")
          : empty("Nothing declined", "Appeals you decline are kept here, hidden from everyone else.");
  } else {
    const rows = [...pending, ...granted].sort((a, b) => b.created_at - a.created_at);
    list = rows.length
      ? `<ul class="appeals">${rows.map((a) => receivedCard(a, { isOwner: false, back, isNew: false, yours: a.from_id === me?.id })).join("")}</ul>`
      : `<p class="none-yet">No appeals to @${h} yet.${p.ownerKnown ? "" : ` @${h} hasn't signed in to Unblockpls.`}</p>`;
  }

  // --- side panel ---
  let side: string;
  if (isOwner && p.tab === "sent") {
    side = `<section class="panel">
        <h2>Blocked by someone else?</h2>
        <p>You can file up to 20 appeals a day, one per person.</p>
        <a class="btn primary" href="/">File an appeal</a>
      </section>`;
  } else if (isOwner) {
    const shareText = `Did I block you? File your appeal here and I'll think about it.`;
    side = `<section class="panel">
        <h2>Send people here</h2>
        <p>Anyone you've blocked can file an appeal at this link.</p>
        <p class="url">${esc(host(pageUrl))}</p>
        <div class="panel-actions">
          ${copyButton(pageUrl, "Copy link", "primary")}
          <a class="btn small ghost" href="https://x.com/intent/post?text=${encodeURIComponent(shareText)}&amp;url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">${ICON.x}<span>Post it</span></a>
        </div>
      </section>
      <section class="panel quiet">
        <h2>Page settings</h2>
        <form method="post" action="/settings" class="setting">
          <input type="hidden" name="closed" value="${closed ? "0" : "1"}">
          <p><b>Appeals are ${closed ? "off" : "on"}.</b> ${closed ? "Nobody new can appeal to you." : "Anyone signed in with X can appeal to you."}</p>
          <button class="btn small ghost">${closed ? "Turn on" : "Turn off"}</button>
        </form>
        <details class="danger">
          <summary>Delete my account</summary>
          <p>Removes your profile, every appeal you filed and every appeal filed to you. This can't be undone.</p>
          <form method="post" action="/account/delete" data-confirm="Delete your account and all of your appeals?"><button class="btn small danger-btn">Delete everything</button></form>
        </details>
      </section>`;
  } else if (me && p.mine) {
    const st = statusOf(p.mine);
    const decided = st === "granted" || st === "declined";
    side = `<section class="panel">
        <div class="panel-head"><h2>Your appeal</h2>${stamp(st)}</div>
        <p>${
          st === "granted"
            ? `@${h} granted it ${ago(p.mine.granted_at!)}. You should be unblocked on X.`
            : st === "declined"
              ? `@${h} declined it ${ago(p.mine.declined_at!)}.`
              : st === "seen"
                ? `@${h} saw it ${ago(p.mine.seen_at!)} and hasn't answered.`
                : `Filed ${ago(p.mine.created_at)}. @${h} hasn't opened this page since.`
        }</p>
        ${decided || closed ? (p.mine.note ? `<p class="note">${esc(p.mine.note)}</p>` : "") : appealForm({ to: owner.handle, lockTo: true, note: p.mine.note, back: p.path, editing: true })}
        ${decided ? "" : `<form method="post" action="/appeals/${p.mine.id}/withdraw" data-confirm="Withdraw your appeal to @${h}?"><input type="hidden" name="back" value="${esc(p.path)}"><button class="linkbtn">Withdraw appeal</button></form>`}
      </section>`;
  } else if (closed) {
    side = "";
  } else if (me) {
    side = `<section class="panel">
        <h2>Did @${h} block you?</h2>
        ${appealForm({ to: owner.handle, lockTo: true, back: p.path })}
      </section>`;
  } else {
    side = `<section class="panel">
        <h2>Did @${h} block you?</h2>
        <p>Sign in with X to file an appeal on this page.</p>
        ${signInButton(p.path)}
        <p class="fine">Are you @${h}? Sign in to read the notes and answer them.</p>
      </section>`;
  }

  // --- header + tabs ---
  const tab = (key: string, label: string, n: number) =>
    `<a href="/@${h}${key === "pending" ? "" : `?tab=${key}`}" ${p.tab === key ? 'aria-current="page"' : ""}>${label} <span class="n">${n}</span></a>`;
  const tabs = isOwner
    ? `<nav class="tabs" aria-label="Your appeals">
         ${tab("pending", "Pending", pending.length)}${tab("granted", "Granted", granted.length)}${tab("declined", "Declined", declined.length)}
         <span class="tabs-gap"></span>${tab("sent", "Sent", p.sent.length)}
       </nav>`
    : "";

  const filedBanner =
    isOwner && p.ok === "filed"
      ? `<div class="banner ok filed" role="status">
           <p><b>Appeal filed.</b> X won't tell ${p.filedTo ? "@" + esc(p.filedTo) : "them"}, so it waits until they open their page. Know a mutual? Pass the link along.</p>
           ${p.filedTo ? copyButton(`${p.origin}/@${p.filedTo}`, "Copy link", "ghost") : ""}
         </div>`
      : "";

  const tally =
    closed || isOwner || (!pending.length && !granted.length)
      ? ""
      : `<dl class="tally-boxes"><div><dt>Pending</dt><dd>${pending.length}</dd></div><div><dt>Granted</dt><dd>${granted.length}</dd></div></dl>`;

  const body = `<section class="phead">
      ${av(owner.handle, owner.avatar, "lg")}
      <div class="phead-main">
        <p class="eyebrow">${isOwner ? "Your page" : "Appeals to"}</p>
        <h1>${owner.name ? esc(owner.name) : `@${h}`}</h1>
        <p class="phead-sub">${owner.name ? `@${h} · ` : ""}<a href="https://x.com/${h}" target="_blank" rel="noopener">x.com/${h} ${ICON.out}</a></p>
      </div>
      ${tally}
    </section>
    ${filedBanner}${banner(p.err, p.ok)}
    ${tabs}
    <div class="cols ${isOwner ? "owner" : "visitor"}">
      <div class="col-main">${list}</div>
      ${side ? `<aside class="col-side">${side}</aside>` : ""}
    </div>`;

  const n = pending.length;
  return layout({
    title: isOwner ? "Your appeals · Unblockpls" : `Appeals to @${owner.handle} · Unblockpls`,
    desc: n ? `${plural(n, "person is", "people are")} asking @${owner.handle} to unblock them. Blocked too? File your appeal.` : `Blocked by @${owner.handle}? File an appeal and they'll see it here.`,
    v,
    body,
    path: p.path,
    origin: p.origin,
  });
}

// ---------- small pages ----------

const NO_VIEWER: Viewer = { me: null, pending: 0, theme: "auto" };

export function messagePage(title: string, text: string, v: Viewer = NO_VIEWER): string {
  return layout({
    title: `${title} · Unblockpls`,
    v,
    body: `<section class="message"><h1>${esc(title)}</h1><p class="lede">${esc(text)}</p><a class="btn ghost" href="/">Back to the front page</a></section>`,
  });
}

export function devLoginPage(users: User[], next: string): string {
  const n = encodeURIComponent(next);
  return layout({
    title: "Local sign-in · Unblockpls",
    v: NO_VIEWER,
    body: `<section class="message">
      <p class="eyebrow">Local testing only</p>
      <h1>Who are you today?</h1>
      <p class="lede">This stands in for Sign in with X on your machine. It doesn't exist in production.</p>
      ${
        users.length
          ? `<ul class="personas">${users
              .map((u) => `<li><a href="/auth/dev?handle=${esc(u.handle)}&amp;next=${n}">${av(u.handle, u.avatar)}<span><b>${esc(u.name)}</b><br>@${esc(u.handle)}</span></a></li>`)
              .join("")}</ul>`
          : ""
      }
      <form method="get" action="/auth/dev" class="inline-form">
        <input type="hidden" name="next" value="${esc(next)}">
        <div class="handle-field"><span aria-hidden="true">@</span><input name="handle" aria-label="Handle" placeholder="or any handle" required pattern="[A-Za-z0-9_]{1,15}" autocapitalize="off" spellcheck="false"></div>
        <button class="btn primary">Sign in</button>
      </form>
    </section>`,
  });
}
