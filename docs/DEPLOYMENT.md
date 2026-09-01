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
  the API Worker through Cloudflare's own guided setup.
  [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kenresoft-technologies/kenresoft-cms)
  `wrangler.toml` deliberately lives at the **repository root**, not inside `apps/api/` where
  the Worker's own source code is — the button only detects a config there, and a subdirectory
  URL would do a sparse checkout that breaks `apps/api`'s `workspace:*` dependencies on
  `@kenresoft/database`/`@kenresoft/contracts` (this failed exactly this way, with Cloudflare
  reporting "No Wrangler configuration detected", before the config moved to the root — see
  `wrangler.toml`'s own top comment). A full end-to-end button click-through hasn't been
  re-confirmed since that fix; if you hit anything else unexpected, `pnpm run setup` below does
  the same job locally, guaranteed to work since it's the same `wrangler` this whole doc relies
  on.
- **Guided CLI** — clone the repo, then:
  ```bash
  pnpm install
  pnpm run setup
  ```
  Runs `scripts/setup.mjs`: checks you're logged in to `wrangler`, creates a D1 database and R2
  bucket if you don't already have them configured, applies migrations, sets
  `BETTER_AUTH_SECRET`, deploys, fixes up `BETTER_AUTH_URL` once the real deployed URL is known,
  and optionally deploys `apps/admin` to Cloudflare Pages too. Recommended for anyone not
  deploying through CI.
- **Manual** — the full walkthrough below. Read this if you want to understand (or script)
  every step yourself, or the guided paths above don't fit your setup.

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
wrangler d1 create kenresoft-cms-db --binding DB --update-config
wrangler r2 bucket create kenresoft-cms-media --binding MEDIA_BUCKET --update-config
```

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
pnpm --filter @kenresoft/api deploy
pnpm --filter @kenresoft/database migrate:remote
```

Deploy first: if you skipped the explicit `wrangler d1 create` in step 3, this is what
auto-provisions your D1 database — migrations need it to already exist, so this order matters
(reversing it fails with "database not found" the very first time, since nothing's created it
yet). Once the database exists at all, either order is fine on every deploy after this one.

The first request to your deployed Worker's sign-up page becomes the owner account
(`docs/ARCHITECTURE.md` §10) — there's no separate seeding step.

## 7. The marketing site (optional)

`examples/astro-site` is a reference Astro integration, not a required part of the CMS. It
renders server-side (Cloudflare Pages Functions via `@astrojs/cloudflare`) and fetches from
your public API at request time — no rebuild needed when you publish new content.

```bash
wrangler pages project create your-cms-site
cd examples/astro-site
PUBLIC_KENRESOFT_CMS_URL=https://your-worker-url pnpm build
wrangler pages deploy dist --project-name your-cms-site --branch main
```

## 8. The admin app

Deploy `apps/admin` to Cloudflare Pages the same way as the marketing site above, **after**
step 6 — `VITE_API_URL` is baked into the build by Vite (build-time only, never
runtime-configurable), so it needs your API's real deployed URL to already exist:

```bash
wrangler pages project create your-cms-admin
cd apps/admin
VITE_API_URL=https://your-worker-url pnpm build
wrangler pages deploy dist --project-name your-cms-admin --branch main
```

Then close the loop: add the resulting `https://your-cms-admin.pages.dev` origin to
`wrangler.toml`'s `CORS_ORIGINS` (step 4) and redeploy the API once more — without
this, sign-in from the deployed admin app fails, since the API rejects cross-origin cookie auth
from an origin it doesn't recognize (`docs/ARCHITECTURE.md` §9). `pnpm run setup` automates this
entire sequence, including the final redeploy, if you opt into it when prompted.

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
| `CLOUDFLARE_ADMIN_PAGES_PROJECT` | The admin app's Pages project name from step 8. |
| `PUBLIC_KENRESOFT_CMS_URL` | Your deployed API's public URL, baked into the marketing site build. |
| `CLOUDFLARE_PAGES_PROJECT` | The marketing site's Pages project name from step 7. |

Using a GitHub [Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
named `production` (every deploy job already declares `environment: production`) lets you add
required reviewers or a wait timer on top of the `DEPLOY_ENABLED` gate — recommended once this
is deploying somewhere real. The workflow also sets `concurrency: deploy-production` so two
deploys can never race each other.

None of this is required — `wrangler deploy` / `wrangler pages deploy` from your own machine or
CI provider is just as valid a way to ship changes.

## Backups and recovery

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
