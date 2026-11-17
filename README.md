# Unblockpls

Blocked on X? Sign in, name who blocked you, and leave a note of up to 280 characters.
They see it at `/@theirhandle`, open your profile on X to unblock you, and mark the appeal granted or declined.

Live at https://unblock.timo.gg

- **Stack:** one Cloudflare Worker (server-rendered HTML, no framework), D1 for data, static assets for CSS/JS/fonts.
- **Privacy:** notes are visible only to the sender and the recipient. Declined appeals are visible only to those two.
  Who appealed to whom is public.
- **X API use:** one `GET /2/users/me` call per sign-in. Profile pictures for people who haven't signed in come from
  unavatar.io, cached at the edge for a week, with a generated letter avatar as fallback.

## Run locally

```sh
npm install
npm run db:local     # create the local D1 tables
npm run seed         # optional: demo people and appeals
npm run dev
```

`.dev.vars` (gitignored) needs:

```
SESSION_SECRET=anything
DEV_LOGIN=1
```

`DEV_LOGIN=1` turns "Sign in with X" into a local persona picker so everything can be tested without X credentials.
It must never be set in production; without it `/auth/dev` returns 404.

## Deploy

```sh
npm run db:remote    # apply migrations to the production D1
npm run deploy
```

Secrets (set once with `npx wrangler secret put NAME`):

| Name | What |
| --- | --- |
| `SESSION_SECRET` | Random string that signs session cookies |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X OAuth 2.0 app (Web App, confidential client). Callback: `https://unblock.timo.gg/auth/callback`. Scopes: `users.read tweet.read` |

Until the X secrets are set, the sign-in button shows a "Sign-in opens soon" page.

## Layout

- `src/index.ts` routes and actions
- `src/auth.ts` sign-in (everything provider-specific lives here)
- `src/views.ts` HTML
- `public/` CSS, JS, fonts, share image
- `migrations/` D1 schema
