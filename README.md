# Unblock

Sign in with X, post an unblock appeal (and an optional 280-character note) to someone who blocked you.
They see it at `/@theirhandle` and click through to your X profile to unblock you.

Cloudflare Worker + D1 + static assets. No framework, no build step beyond wrangler.

## Run locally

```sh
npm install
npm run db:local
npm run dev
```

`.dev.vars` (gitignored) needs:

```
SESSION_SECRET=anything
DEV_LOGIN=1
```

`DEV_LOGIN=1` enables `/auth/dev?handle=alice`, a stand-in for X sign-in so you can test without X credentials.
Never set it in production.

## Deploy

1. `npx wrangler d1 create unblock` and paste the `database_id` into `wrangler.jsonc`.
2. Create an app at developer.x.com with OAuth 2.0 enabled (type: Web App, confidential client),
   callback URL `https://unblock.timo.gg/auth/callback`, scopes `users.read` + `tweet.read`.
3. Set Worker secrets:
   ```sh
   npx wrangler secret put X_CLIENT_ID
   npx wrangler secret put X_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET   # openssl rand -base64 32
   ```
4. Uncomment `routes` in `wrangler.jsonc` for the custom domain.
5. Add `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit) and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions
   secrets; pushes to `main` then migrate D1 and deploy.

## X API usage

One call per sign-in (`GET /2/users/me`), nothing else. Sessions last 30 days. Handle search only covers accounts
Unblock already knows (people who signed in or were appealed to); any valid handle can still be typed in.
