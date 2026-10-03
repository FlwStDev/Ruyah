# PostForge

Local-first publishing to **X**, **Reddit** and **Instagram**. Write once, pick destinations,
publish now or schedule, and watch each job land.

It runs entirely on your machine, against **your own** developer apps and **your own** accounts.
There is no hosted service, no multi-tenant anything, and no scraping: every post goes out through
the network's official API, as you, with a token you granted.

---

## What it does

- Email + password login (single local user; registration closes behind `ALLOW_REGISTER`)
- Connect X / Reddit / Instagram via OAuth; tokens encrypted at rest with AES-256-GCM
- Upload images and video, normalize with sharp, keep them in a local library
- Compose once with per-network caption overrides and per-network options
- Publish immediately or schedule; a separate worker process does the actual posting
- Per-destination job states: `queued -> uploading -> publishing -> published | failed | canceled`
- Automatic retries on 429/5xx only, cancel a scheduled job, retry a failed one, deep link to the
  live post
- **Folder drip:** point at a local folder; the worker posts the oldest unused file on a cadence
  (e.g. every hour) and moves it to `_posted`

---

## Quick start

```bash
pnpm i
cp .env.example .env          # Windows: copy .env.example .env
```

Generate the two required secrets and paste them into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # TOKEN_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
```

Then:

```bash
pnpm prisma migrate dev       # creates dev.db and the seed admin user
pnpm dev                      # http://localhost:3000
```

In a **second terminal**, start the worker. Nothing publishes without it:

```bash
pnpm worker
```

Open http://localhost:3000, register (the first account is always allowed), and go to
**Settings -> Setup** to see what still needs configuring.

Seed login, if you would rather not register: `admin@postforge.local` / `postforge-dev`
(from `SEED_EMAIL` / `SEED_PASSWORD`; change them).

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js app |
| `pnpm worker` | Job runner, polls every 5s |
| `pnpm smoke` | Structural check: routes, pages, adapters, env, DB |
| `pnpm test` | Adapter unit tests with mocked fetch |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:studio` | Browse the database |
| `pnpm db:seed` | Re-create the seed user (never overwrites an existing one) |

---

## Creating the developer apps

You need one app per network. All three are free.

### X

1. Go to **https://console.x.com** -> your project -> **Keys and tokens** / **User authentication settings**.
2. Set up **User authentication**:
   - **App permissions:** *Read and write*
   - **Type of App:** *Web App, Automated App or Bot* (this is a confidential client)
   - Run `pnpm tunnel` (keeps a Cloudflare HTTPS URL pointed at this machine)
   - **Website URL:** the `https://….trycloudflare.com` origin it prints
   - **Callback URI:** that origin + `/api/oauth/x/callback`

   X’s settings form rejects `localhost`, `127.0.0.1`, and most `http://` hosts.
   Both fields must be `https://` and share the same hostname. Keep the tunnel running
   while you Connect.
3. Copy the **OAuth 2.0 Client ID** and **Client Secret** into `X_CLIENT_ID` / `X_CLIENT_SECRET`.

PostForge uses OAuth 2.0 Authorization Code **with PKCE** and asks for
`tweet.read tweet.write users.read offline.access media.write`. `offline.access` is what gets you a
refresh token; without it the connection dies after a couple of hours.

> Posting requires a paid X API tier. The Free tier is read-only for most endpoints, so a text post
> may come back as 403 "not permitted". That error is shown verbatim on the job.

### Reddit

1. Go to **https://www.reddit.com/prefs/apps** -> **create another app...**
2. Choose **web app** (not "script" - script apps cannot do the authorization-code flow properly).
3. **redirect uri:** `http://localhost:3000/api/oauth/reddit/callback`
4. The **client id** is the string under the app name; the **secret** is labelled `secret`.
5. Set `REDDIT_USER_AGENT` to include your real username:
   `web:postforge:0.1.0 (by /u/yourname)`

Scopes: `identity submit read mysubreddits flair`. PostForge requests `duration=permanent`, which is
what makes Reddit issue a refresh token.

**r/test** is a good first target. Reddit refuses generic user agents, so PostForge will not even
try to call the API while `REDDIT_USER_AGENT` still says `/u/replace`.

### Instagram

Instagram is the fiddliest of the three.

1. **https://developers.facebook.com** -> **Create App** -> use case **Other** -> type **Business**.
2. Add the **Instagram** product, then **API setup with Instagram login**.
3. Under **Business login settings**:
   - **OAuth redirect URI:** `http://localhost:3000/api/oauth/instagram/callback` (exactly, no
     trailing slash)
   - Permissions: `instagram_business_basic`, `instagram_business_content_publish`
4. Copy the **Instagram App ID** and **Instagram App Secret** into `INSTAGRAM_CLIENT_ID` /
   `INSTAGRAM_CLIENT_SECRET`. (These are the *Instagram* app credentials, not the Facebook app ones.)
5. Add yourself as an **Instagram tester**: App roles -> Roles -> add your Instagram account, then
   accept the invite in the Instagram app under *Settings -> Apps and websites -> Tester invites*.

**Your Instagram account must be a professional account** (Business or Creator). A personal account
cannot publish through the API; PostForge detects this at connection time and says so instead of
failing later with a cryptic Graph error. Switch in the Instagram app:
*Settings -> Account type and tools -> Switch to professional account*.

---

## Why Instagram needs a tunnel

Instagram does not accept file uploads. You create a media container pointing at a **public HTTPS
URL**, and Instagram's servers download the file themselves. `http://localhost:3000` is not
reachable from Meta's network, so a local-only setup can never publish to Instagram.

The fix is a tunnel:

```bash
ngrok http 3000
# or
cloudflared tunnel --url http://localhost:3000
```

Put the HTTPS origin it prints into `.env` and restart the dev server:

```env
PUBLIC_BASE_URL=https://your-subdomain.ngrok.app
```

PostForge then serves each file from `/api/public/media/<publicId>?t=<token>`, the one route in the
app without authentication. It is guarded by an unguessable 128-bit id plus a 192-bit token compared
in constant time, and it only ever serves rows from the media table.

Without `PUBLIC_BASE_URL`, Instagram is disabled in the composer with an explicit message rather
than failing at publish time.

**Reddit does not need the tunnel.** Reddit image and video posts upload the bytes directly to
Reddit's own storage (`/api/media/asset.json` + S3 PUT + `/api/submit`), so native media works
from localhost.

---

## Rate limits and quotas

This tool posts as you. Burning your quota or tripping spam detection is your account's problem, so
PostForge is deliberately unhurried:

- The worker polls every 5s (`WORKER_POLL_INTERVAL_MS`) and runs 2 jobs at a time
  (`WORKER_CONCURRENCY`).
- **Retries only happen on 429 and 5xx**, twice, backing off 30s then 2min. A 4xx is a logic error;
  retrying it just repeats the same rejection.
- **X:** posting caps are tied to your API tier and are small. Watch for 429 and the
  `x-rate-limit-reset` header, which PostForge includes in the error message.
- **Reddit:** 100 queries per minute per OAuth client, and a much stricter unwritten limit on
  *submissions*. New or low-karma accounts get rate-limited after a handful of posts. Reddit also
  requires the descriptive `User-Agent` - a generic one gets you throttled or blocked.
- **Instagram:** 50 published posts per 24 hours per account, and container creation is itself rate
  limited. Container processing takes anywhere from seconds to a minute for Reels; PostForge polls
  for up to 2 minutes before giving up.

Do not point this at a scheduler that fires dozens of posts at once.

---

## Consent and conduct

PostForge publishes **as the connected user**, using a token that user explicitly granted through
the network's own OAuth consent screen. It does not scrape, does not log in with
session cookies, and does not use unofficial endpoints. Disconnecting an account deletes its tokens
from the database immediately; you can also revoke access from the network's own app settings.

You are responsible for what you post and for following each network's content and automation
rules.

---

## How it works

```
src/
  app/
    (auth)/            login, register
    (app)/             compose, posts, calendar, media, settings
    api/               route handlers
  lib/
    social/            the adapters - types.ts, x.ts, reddit.ts, instagram.ts, index.ts
    jobs/runner.ts     claim, publish, retry, recover
    accounts.ts        token decryption + refresh
    compose.ts         validation -> Post + PostJob rows
    crypto.ts          AES-256-GCM
    storage.ts         StorageService (local disk today, S3 later)
worker.ts              the polling process
prisma/schema.prisma   User, ConnectedAccount, MediaAsset, Compose, Post, PostMedia, PostJob, OAuthState
uploads/               your media (gitignored)
```

### Adapters

Every network implements the same interface (`src/lib/social/types.ts`):

```ts
interface SocialAdapter {
  id: "x" | "reddit" | "instagram";
  getAuthUrl(state, codeVerifier?): string;
  exchangeCode(params): Promise<ConnectedAccountTokens>;
  refresh(account): Promise<ConnectedAccountTokens>;
  getMe(account): Promise<{ id: string; username: string }>;
  publish(account, payload): Promise<{ id: string; permalink: string }>;
}
```

Adding a network means writing one file and registering it in `src/lib/social/index.ts`.
TikTok, YouTube, Facebook and Threads are listed in `src/lib/social/stubs.ts` as explicit
not-implemented entries.

### Not double-posting

The dangerous case is a process dying between "request sent" and "result stored" - the post exists
but PostForge does not know it. Three layers handle this:

1. Claiming a job is a conditional update (`where status = 'queued'`), so two workers cannot take
   the same job.
2. A job that already has a `platformPostId` is never published again, by any path, including a
   manual retry (the retry endpoint returns 409).
3. A job still locked after 10 minutes is parked as `failed` with `needsReview`, and is **never**
   auto-retried. The UI tells you to check the platform before retrying, because only a human can.

### Scheduling

`datetime-local` is wall-clock in your browser's timezone; it is converted to UTC before storage and
rendered back in local time. A scheduled job sits in `queued` until `scheduledFor <= now`, which the
worker checks every poll. **If the worker is not running at that moment, nothing goes out** - it
will publish late, as soon as the worker next starts.

### Folder drip

**Drip** in the nav. Paste an absolute folder path (`C:\Users\you\queue`), pick an interval (1 hour
is the default), pick destinations, and start it.

- One file per interval, oldest first (by modified time)
- jpg / png / webp / gif / mp4 only; hidden files and `_posted` are ignored
- Caption from the filename, a fixed string, or media-only
- After queueing: move the file to `folder\_posted` (default) or leave it and remember the path
- **Post next now** queues immediately; Pause stops the clock
- The same worker publishes the resulting jobs. No worker = files sit in the folder

---

## Notes and limits

- **SQLite** via Prisma. The schema avoids enums and scalar lists, so switching
  `datasource.provider` to `postgresql` and re-running migrate is all it takes to move.
- **Video on Reddit** needs a poster image. Generating one from the mp4 would require a system
  ffmpeg, which this app deliberately does not depend on, so PostForge uploads a plain dark
  placeholder. If you want a real frame, install ffmpeg and extract it yourself.
- **Video duration/dimensions** are not probed for the same reason; images are measured with sharp.
- **Media limits:** 4 images *or* 1 video per post, 100 MB per file.
- The X character count is a **soft warning**. Premium accounts can exceed 280, so it is never a
  hard block.
- Uploads live in `uploads/`. They are gitignored, and so are `.env` and `dev.db`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Job fails "not connected" | Connect the account, or it was disconnected after scheduling |
| Job fails with a `REDDIT_USER_AGENT` message | Still set to `/u/replace` |
| Instagram disabled in composer | `PUBLIC_BASE_URL` is unset or not `https://` |
| "Could not decrypt the stored token" | `TOKEN_ENCRYPTION_KEY` changed; reconnect the accounts |
| Scheduled post never went out | The worker was not running; start `pnpm worker` |
| Folder drip does nothing | Path is wrong, folder is empty, drip is paused, or the worker is down |
| OAuth callback rejected | The redirect URI in the console does not match `.env` exactly |
