# Deploying your own instance

Kenresoft CMS is a reusable, open-source codebase — not a hosted service. Deploying it means
provisioning your **own** Cloudflare account's resources and pointing your own fork at them
(`docs/ARCHITECTURE.md` §11, "Single Site Per Instance"). Nothing in this repository, including
its GitHub Actions workflows, deploys to Kenresoft's own Cloudflare account on your behalf —
every value that would need to be, is either configured per-deployment in files you edit after
forking, or supplied via secrets/variables that belong to your own GitHub repository, or (for
the API Worker) provisioned automatically the first time you deploy — see below.

## Three ways to deploy

- **One-click** — the button below clones this repo into your own GitHub account and deploys
  the API Worker (only — see "Two Workers, one install" below) through Cloudflare's own guided
  setup. **Verified with a real click-through**, not just reasoned about: it correctly deploys
  the API Worker end to end.
  [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kenresoft-technologies/kenresoft-cms)
  `wrangler.toml` deliberately lives at the **repository root**, not inside `apps/api/` where
  the Worker's own source code is — the button only detects a config there, and a subdirectory
  URL makes Cloudflare treat that subdirectory as the *entire* contents of the new repo it
  creates, which would break `apps/api`'s `workspace:*` dependencies on
  `@kenresoft-cms/database`/`@kenresoft-cms/contracts` (this failed exactly this way, with Cloudflare
  reporting "No Wrangler configuration detected", before the config moved to the root — see
  `wrangler.toml`'s own top comment, and [`apps/api/README.md`](../apps/api/README.md) for the
  full explanation). There is no equivalent button for the Admin Worker — see
  [`apps/admin/README.md`](../apps/admin/README.md) for exactly why, confirmed empirically, not
  assumed.
- **Guided CLI** — clone the repo, then:
  ```bash
  pnpm install
  pnpm run setup
  ```
  Runs `scripts/setup.mjs` — every step below is an explicit action the script performs, not
  implicit "magic" (only wrangler's own D1/R2 auto-provisioning, used internally by a couple of
  these steps, is genuinely automatic on Cloudflare's side): checks you're logged in to
  `wrangler`, creates a D1 database and R2 bucket if you don't already have them configured,
  applies migrations, sets `BETTER_AUTH_SECRET`, deploys the API Worker, fixes up
  `BETTER_AUTH_URL` once the real deployed URL is known, then builds and deploys `apps/admin` as
  its own Worker too (see "Two Workers, one install" below) and wires its origin into
  `CORS_ORIGINS` for you — idempotently: running `pnpm run setup` again never appends a
  duplicate origin, re-provisions an existing D1/R2, or otherwise redoes work that's already
  done. One command, both apps live. Recommended for anyone not deploying through CI.
- **Manual** — the full walkthrough below. Read this if you want to understand (or script)
  every step yourself, or the guided paths above don't fit your setup. Component-level detail
  (prerequisites, config, deploying just one piece) lives in each app's own README:
  [`apps/api/README.md`](../apps/api/README.md), [`apps/admin/README.md`](../apps/admin/README.md).

## Two Workers, one install

A full Kenresoft CMS installation is **two independent Cloudflare Workers**, not one:

- `apps/api` — the Hono API, D1, R2, auth, everything in `docs/ARCHITECTURE.md`. Config at the
  repository root (`wrangler.toml`; see that file's own comment for why it isn't inside
  `apps/api/`).
- `apps/admin` — the React/Vite dashboard, deployed as Workers **static assets**
  (`apps/admin/wrangler.toml`), not Cloudflare Pages. Cloudflare's own docs now steer new
  static-hosting projects toward Workers Static Assets instead (Pages carries a migration
  banner in Cloudflare's docs; the older Workers Sites mechanism is deprecated in favor of it),
  so this keeps both halves of the CMS on the same, currently-recommended primitive.

They stay two separate deploys/URLs/version histories on purpose — `apps/admin` only ever talks
to the API the way it always has, over its own public HTTPS URL via `VITE_API_URL` and `fetch()`
(`apps/admin/src/lib/api-client.ts`, `auth-client.ts`), the same as when you run it locally
against a remote API. Nothing about that integration changes; only *where* the admin app itself
runs does. The tradeoff this buys you: deploying or rolling back the admin app can never touch
the API's own deployment, and vice versa.

Because they're two different origins by default, the API's CORS allow-list (`CORS_ORIGINS`)
and its cookies (`sameSite: 'none', secure: true` — see `apps/api/src/lib/auth-options.ts`'s own
comment) already handle cross-origin sign-in; both guided paths above (button+CLI-finish, or
`pnpm run setup` alone) wire the admin's real deployed origin into `CORS_ORIGINS` for you. If you
own a custom domain, you can additionally put both Workers behind one hostname with a
[Route](https://developers.cloudflare.com/workers/configuration/routing/routes/) per path
(`/api/*` to the API Worker, everything else to the admin Worker) for a single-origin experience
with no CORS at all — this is a deliberate later upgrade, not part of the default install, since
it needs a Cloudflare-managed zone the default `*.workers.dev` setup doesn't require.

## 1. Prerequisites

- A Cloudflare account (the free tier covers Workers, D1, and R2 at this project's scale).
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) installed and logged in:
  `wrangler login`.
- `pnpm` installed (`corepack enable` or `npm install -g pnpm`).
- Node 20+.

## 2. Fork or clone the repository

```bash
git clone https://github.com/kenresoft-technologies/kenresoft-cms.git your-site-name
cd your-site-name
pnpm install
```

## 3. Provision your own Cloudflare resources

`wrangler.toml`'s `[[d1_databases]]`/`[[r2_buckets]]` bindings deliberately omit their
`database_id`/`bucket_name` — this triggers wrangler's own
[automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/):
the first plain `wrangler deploy` you run (step 6) creates a fresh D1 database and R2 bucket on
*your* account and writes their real ids back into `wrangler.toml` for you, non-interactively.
**You can skip straight to step 5** unless you want more control than that — a specific
`--location` hint, or resource names that don't match this repo's defaults:

```bash
wrangler d1 create kenresoft-cms-db --binding DB
wrangler r2 bucket create kenresoft-cms-media --binding MEDIA_BUCKET
```

Both commands print a `[[d1_databases]]`/`[[r2_buckets]]` snippet with the real `database_id`/
`bucket_name` — copy those two values into the matching block in `wrangler.toml` yourself.
**Don't add `--update-config`**: it sounds like it should do that copy for you (and does, for a
`wrangler.jsonc`/`.json` config), but confirmed empirically against this repo's `wrangler.toml`
it silently does nothing to the file — no error, just the same manual-instructions snippet
either way. If you skip pasting the id in by hand after using this explicit path, your next
`wrangler deploy` sees `database_id` still missing and auto-provisions a *second* database (which
then fails outright for D1, since the name you already used is now taken).

Either way, the rate-limiting bindings (`[[ratelimits]]`) use arbitrary, account-unique
`namespace_id` values (`"1001"`, `"1002"`, `"1003"`) — these are not provisioned resources, so
leave them as-is regardless.

## 4. CORS_ORIGINS and BETTER_AUTH_URL

Two `[vars]` in `wrangler.toml` you'll want to revisit once you have real URLs:

- `CORS_ORIGINS`: append your deployed admin app's real origin once you've deployed it (step 8)
  — the committed default is just the local Vite dev server's ports.
- `BETTER_AUTH_URL`: **can't be set correctly before your first deploy** — a Worker has no
  `*.workers.dev` URL until it exists. The committed placeholder
  (`https://REPLACE_AFTER_FIRST_DEPLOY.workers.dev`) is safe to deploy with as-is (it only
  affects redirect/callback URL construction, not cookie security — see the file's own comment)
  — deploy once (step 6), copy the real URL wrangler prints, paste it in here, then deploy again.
  `pnpm run setup` automates exactly this.

## 5. Set secrets

```bash
cd apps/api
wrangler secret put BETTER_AUTH_SECRET   # any long random string — never commit this
```

Local dev also needs `.dev.vars` (copy `.dev.vars.example`) — it overrides both `[vars]` and
secrets during `wrangler dev`, so your local `BETTER_AUTH_SECRET` can differ from the deployed
one.

## 6. Deploy, then run migrations

```bash
pnpm --filter @kenresoft-cms/api deploy
pnpm --filter @kenresoft-cms/database migrate:remote
```

Deploy first: if you skipped the explicit `wrangler d1 create` in step 3, this is what
auto-provisions your D1 database — migrations need it to already exist, so this order matters
(reversing it fails with "database not found" the very first time, since nothing's created it
yet). Once the database exists at all, either order is fine on every deploy after this one.

The first request to your deployed Worker's sign-up page becomes the owner account
(`docs/ARCHITECTURE.md` §10) — there's no separate seeding step.

## 7. The marketing site (optional)

`examples/astro-site` is a reference Astro integration, not a required part of the CMS — a
separate frontend that happens to consume the CMS's public API, not one of the CMS's own two
Workers (API + Admin, both moved to Workers Static Assets — see "Two Workers, one install"
above). It renders server-side (Cloudflare Pages Functions via `@astrojs/cloudflare`) and
fetches from your public API at request time — no rebuild needed when you publish new content.

This example deploys to Cloudflare **Pages** below, not Workers, because that's simply
`@astrojs/cloudflare`'s own default adapter target for this Astro version — it is not a required
or even recommended choice specific to this CMS, and Pages remains a fully supported Cloudflare
product for it. If your own site's Astro/framework setup targets Workers Static Assets instead
(or a different host entirely), use that instead; nothing about the CMS's own two Workers depends
on how you deploy this separate example.

```bash
wrangler pages project create your-cms-site
cd examples/astro-site
PUBLIC_KENRESOFT_CMS_URL=https://your-worker-url pnpm build
wrangler pages deploy dist --project-name your-cms-site --branch main
```

## 8. The admin app

`apps/admin` deploys as its **own Worker** (`apps/admin/wrangler.toml` — static assets, not
Cloudflare Pages; see "Two Workers, one install" above), **after** step 6 — `VITE_API_URL` is
baked into the build by Vite (build-time only, never runtime-configurable), so it needs your
API's real deployed URL to already exist:

```bash
cd apps/admin
VITE_API_URL=https://your-worker-url pnpm build
wrangler deploy
```

`pnpm build` also generates `dist/_headers` (Content-Security-Policy and other security headers,
scoped to the `VITE_API_URL` you just built with) — see
[`apps/admin/README.md`](../apps/admin/README.md#9-workers-static-assets-configuration) for the
full detail and how it was verified. The first deploy also auto-provisions the Worker itself (its
name comes from `apps/admin/wrangler.toml`, no separate project-creation step needed, unlike
Pages). Then close the loop: add the resulting `https://your-cms-admin.<subdomain>.workers.dev`
origin to the
**root** `wrangler.toml`'s `CORS_ORIGINS` (step 4) and redeploy the API once more — without
this, sign-in from the deployed admin app fails, since the API rejects cross-origin cookie auth
from an origin it doesn't recognize (`docs/ARCHITECTURE.md` §9). `pnpm run setup` automates this
entire sequence end to end, including the final redeploy.

## Password recovery & owner recovery

None of this is required to run a deployment — password reset and recovery codes degrade
gracefully with no configuration at all (`docs/ARCHITECTURE.md` §10.1), and the two
owner-recovery mechanisms below are entirely opt-in.

**Password-reset email** — set `EMAIL_PROVIDER` in `wrangler.toml`'s `[vars]` to enable actually
sending the email (it's unset by default, which logs instead of sending — real accounts can
still request a reset, they just don't receive anything):

- **Cloudflare** (`EMAIL_PROVIDER = "cloudflare"`): add a `[[send_email]]` binding to
  `wrangler.toml`:
  ```toml
  [[send_email]]
  name = "EMAIL"
  ```
  then run `wrangler email sending enable` and follow its prompts to verify the domain you'll
  send from (`EMAIL_FROM`, also set in `[vars]`). No per-recipient verification is needed —
  only the sending domain.
- **Resend** (`EMAIL_PROVIDER = "resend"`): verify a sending domain in the
  [Resend dashboard](https://resend.com), set `EMAIL_FROM` to an address on it, and:
  ```bash
  wrangler secret put RESEND_API_KEY
  ```

Either way, also set `ADMIN_URL` to your deployed `apps/admin` origin — it's what the
reset-password link in the email points to. Local dev doesn't need this (it falls back to the
first `CORS_ORIGINS` entry, your local Vite server).

**Break-glass owner recovery** — disabled (404) until you explicitly opt in:

```bash
wrangler secret put OWNER_RECOVERY_SECRET   # a long random string; treat it like a master key
```

Once set, `POST /api/v1/system/recover-owner` with `{ secret, email, newPassword }` resets the
named owner's password. Keep this secret somewhere separate from your normal credentials (a
password manager, not a `.env` file that ends up in a screenshot) — anyone who has it can reset
the owner's password on this specific deployment. Leave it unset if you'd rather rely solely on
the CLI tool below, which needs no standing secret at all.

**Treat this as an extremely sensitive, ideally-temporary capability, not a permanent
convenience.** Unlike a compromised admin session or even a compromised admin password, this
secret bypasses the account entirely — no MFA, no re-authentication, no session to revoke — so
possessing it is equivalent to holding a permanent master key to this deployment for as long as
it stays set. Prefer setting it only when you actually anticipate needing it (or the moment
you're locked out and have Cloudflare account access to run `wrangler secret put`), and unset it
again once you've used it:

```bash
wrangler secret delete OWNER_RECOVERY_SECRET
```

If you do keep it set on an ongoing basis, rotate it periodically the same way you would any
other standing credential, and audit `audit_log` (`owner.recovered` entries) if you ever suspect
it leaked.

**CLI owner recovery** — for when you have real access to the deployment's Cloudflare account
(via `wrangler login` or an API token) but the owner can't sign in at all:

```bash
cd apps/api
pnpm recover-owner:remote           # or recover-owner:local for local dev
```

It looks up the owner account via `wrangler d1 execute`, prompts for a new password
interactively (never as a CLI argument, so it never lands in shell history), and signs that
account out everywhere. Pass `--email someone@example.com` if a deployment ever has more than
one owner, or `--env <name>` if your real D1 database lives under a named environment rather
than `wrangler.toml`'s top level (only relevant if you've set up a split like step 3's optional
explicit provisioning plus your own equivalent of `[env.production]` — most deployments don't
need this flag).

## Automated deploys via GitHub Actions (optional)

`.github/workflows/deploy.yml` can deploy the API Worker, the admin app, and the marketing site
on every push to `main`, but is inert by default — every job is gated on a repository variable,
so forking this repo never risks an accidental deploy attempt against secrets you haven't set.

To enable it, in your fork's **Settings → Secrets and variables → Actions**:

**Repository (or a `production` Environment's) secrets:**

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A token scoped to exactly what deploying needs — Workers Scripts (Edit), D1 (Edit), Pages (Edit), Account (Read). Create one under **My Profile → API Tokens** rather than reusing a broad OAuth/global token. |
| `CLOUDFLARE_ACCOUNT_ID` | From `wrangler whoami`, or your Cloudflare dashboard URL. |

**Repository (or environment) variables:**

| Variable | Value |
| --- | --- |
| `DEPLOY_ENABLED` | `true` — the on/off switch every job checks. Leave unset (or anything else) to keep the workflow a no-op. |
| `VITE_API_URL` | Your deployed API's public URL, baked into the admin app build. |
| `PUBLIC_KENRESOFT_CMS_URL` | Your deployed API's public URL, baked into the marketing site build. |
| `CLOUDFLARE_PAGES_PROJECT` | The marketing site's Pages project name from step 7. |

Using a GitHub [Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
named `production` (every deploy job already declares `environment: production`) lets you add
required reviewers or a wait timer on top of the `DEPLOY_ENABLED` gate — recommended once this
is deploying somewhere real. The workflow also sets `concurrency: deploy-production` so two
deploys can never race each other.

None of this is required — `wrangler deploy` / `wrangler pages deploy` from your own machine or
CI provider is just as valid a way to ship changes.

## Updating an existing install

New CMS features and fixes land on the project's `develop` branch (its default branch) —
`CHANGELOG.md` tracks what actually changed, in plain terms, so you know what you're pulling in
before you do.

From the repo root, run:

```bash
pnpm run update
```

That's the whole thing — it pulls the latest code from the `upstream` git remote (both a plain
`git clone` of this repo and one scaffolded via `npm create @kenresoft-cms@latest` have one
already), installs dependencies, applies any new database migrations, and redeploys both Workers.
Deliberately **not** `pnpm run setup` run again: unlike `setup`, `update` never touches your
`BETTER_AUTH_SECRET`, never re-provisions D1/R2, and never re-prompts for email setup — it's the
safe subset for an install that already exists. (`setup` itself is also safe to re-run if you
genuinely need to — it checks before touching `BETTER_AUTH_SECRET` rather than silently
regenerating it, asking first since rotating it logs out every current user.)

If your install has no `upstream` remote at all (a raw zip download, or one deliberately
removed), `update` skips the code-pull step with a note and still redeploys whatever's on disk —
add the remote yourself to opt back in: `git remote add upstream
https://github.com/kenresoft-technologies/kenresoft-cms.git`. An install scaffolded before this
tool switched from a tarball download to a real `git clone` will hit a one-time prompt the first
time `update` pulls new code, since its local history has no real ancestry to merge against yet
— confirming it is safe to proceed reconciles that once, and every update after is a normal,
low-friction merge.

`update` refuses to run (rather than silently doing the wrong thing) in two situations: if
`wrangler.toml` has no `database_id` at all — meaning `pnpm run setup` was never actually run
for this install — run that first; and if the Worker it's about to redeploy is currently bound
to a *different* D1 database than this install's own `wrangler.toml` expects, meaning it belongs
to a different deployment (every fork of this template ships the same default Worker name, so
one Cloudflare account running more than one deployment of it can collide) — `wrangler deploy`
has no "already exists" safeguard the way provisioning D1/R2 does, so without this check a
redeploy would silently overwrite the other deployment's live Worker. If you hit this, run
`pnpm run setup` again instead: it detects the same collision interactively and picks a new,
unique name for both Workers (pairing the admin Worker's rename to the API Worker's) rather than
just refusing.

## Renaming a Worker (changing its `*.workers.dev` URL)

Cloudflare has no in-place Worker rename — changing `wrangler.toml`'s `name` and redeploying
creates a **new** Worker at the new URL; the old one keeps running, unmodified, at its old URL
until you delete it. Renaming also cascades: the API Worker's URL is baked into the admin app's
build (`VITE_API_URL`) and stored in `BETTER_AUTH_URL`; the admin Worker's URL is stored in the
API's `CORS_ORIGINS` allow-list and `ADMIN_URL` (used to build password-reset email links).
`pnpm run rename-worker` handles all of that for you:

```bash
pnpm run rename-worker -- --target api --name my-new-api-name
pnpm run rename-worker -- --target admin --name my-new-admin-name
```

It checks the new name isn't already taken by an unrelated Worker in your account first (same
`checkWorkerOwnership()` check `update`/`setup` use above), asks you to confirm before doing
anything, deploys the new Worker and updates every cross-reference, then asks whether to delete
the now-unused old Worker — left in place by default if you say no, deletable later yourself with
`wrangler delete <old-name>`.

## Backups and recovery

**D1 also has a free, automatic, zero-setup safety net independent of anything below**:
Cloudflare's [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) retains a
30-day point-in-time-recoverable history of every D1 database with nothing to configure or
remember to run — `wrangler d1 time-travel restore your-cms-db --timestamp=...` restores to any
minute within that window. It's not a substitute for an off-platform export (Time Travel can't
help if Cloudflare itself has an incident, and 30 days is a hard limit), which is what the manual
export below is for, but it means an accidental bad migration or a slip of `DELETE` is recoverable
immediately, at no cost, even if you've never run a manual backup at all. R2 has no equivalent
built-in versioning (confirmed — it's a standing feature request, not shipped), which is exactly
why `backup-media.mjs` below matters more for media than the D1 export does for content.

**D1** (content types, entries, forms, users, settings, media *metadata*): export and restore
both work, verified end-to-end against a real deployment —

```bash
wrangler d1 export your-cms-db --remote --output backup.sql
```

This briefly makes the database unavailable to serve queries while the export runs (a few
seconds at this project's data volume) — plan around that if you automate it. Restoring is the
same file, applied with `wrangler d1 execute your-cms-db --remote --file backup.sql`, or loaded
into any local SQLite tool (`sqlite3 test.db < backup.sql`) to inspect or verify a backup
without touching the live database, which is how this exact export/restore path was verified
while writing this doc.

There's no built-in scheduling for this — run it by hand, or put the export command on a cron
somewhere you control (it's a normal `wrangler` CLI call, nothing D1-specific about scheduling
it).

**R2** (media file bytes — D1 only stores each file's metadata and its R2 key, never the
binary, `docs/ARCHITECTURE.md` §9/§14): there's no single-command bucket export in R2/wrangler,
so `apps/api/scripts/backup-media.mjs` walks the `media` table (the one source of truth for
which R2 keys exist) and downloads/uploads each object individually via `wrangler r2 object
get`/`put` — the same "shell out to wrangler, no driver of its own" approach
`recover-owner.mjs` uses for D1:

```bash
cd apps/api
pnpm backup-media -- --remote --out ./media-backup     # or --local for local dev
pnpm restore-media -- --remote --from ./media-backup
```

Pass `--env <name>` too if your real R2 bucket lives under a named environment rather than
`wrangler.toml`'s top level (same caveat as CLI owner recovery above). Also check the script's
own `BUCKET_NAME` constant matches your actual bucket — it's only reliably
`"kenresoft-cms-media"` if you used step 3's explicit `wrangler r2 bucket create`, not if you
left the bucket name to automatic provisioning (which generates its own name).

A backup is a plain directory: `manifest.json` (every media row's metadata) plus an `objects/`
tree mirroring each file's own R2 key. Restoring only repopulates R2 — run it alongside
restoring the corresponding D1 backup above, since D1's `media` table is what makes those R2
keys discoverable by the app at all; restoring one without the other leaves either orphaned
files with no metadata pointing at them, or metadata pointing at files that don't exist.
Verified end-to-end against a real local deployment (backup, then restore the same objects back
over themselves, then confirmed the bytes were unchanged) the same way the D1 drill above was.

If you'd rather mirror the whole bucket continuously instead of running point-in-time backups,
R2 is also S3-API-compatible, so an S3-aware sync tool (e.g. `rclone`) pointed at your bucket's
S3 endpoint (Cloudflare dashboard → R2 → your bucket → Settings) works too.
