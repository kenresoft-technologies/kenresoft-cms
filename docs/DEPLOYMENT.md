# Deploying your own instance

Kenresoft CMS is a reusable, open-source codebase — not a hosted service. Deploying it means
provisioning your **own** Cloudflare account's resources and pointing your own fork at them
(`docs/ARCHITECTURE.md` §11, "Single Site Per Instance"). Nothing in this repository, including
its GitHub Actions workflows, deploys to Kenresoft's own Cloudflare account on your behalf —
every value that would need to be, is either configured per-deployment in files you edit after
forking, or supplied via secrets/variables that belong to your own GitHub repository.

You do **not** need GitHub Actions to deploy. Everything below works identically run by hand
from your own machine with `wrangler`. The GitHub Actions workflow (`.github/workflows/
deploy.yml`) is one convenience on top of that, entirely optional, and does nothing at all
until you explicitly enable it (see "Automated deploys via GitHub Actions" below).

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

```bash
wrangler d1 create your-cms-db
wrangler r2 bucket create your-cms-media
```

Each command prints an id — you need them in the next step. The rate-limiting bindings in
`apps/api/wrangler.toml` (`[[ratelimits]]`) use arbitrary, account-unique `namespace_id` values
(`"1001"`, `"1002"`) — these are not provisioned resources, so you can leave them as-is.

## 4. Point your fork at your own resources

Edit `apps/api/wrangler.toml`:

- `[[d1_databases]]` → `database_name` and `database_id`: the values `wrangler d1 create`
  just printed.
- `[[r2_buckets]]` → `bucket_name`: the bucket you just created.
- `[vars]` → `CORS_ORIGINS`: your own admin app's real origin(s). The committed value is
  Kenresoft's own dev-convenience list (localhost ports and a personal LAN IP) — replace it,
  don't append to it.
- `[vars]` → `BETTER_AUTH_URL`: your Worker's URL once deployed
  (`https://<name>.<your-subdomain>.workers.dev`, or a custom domain).

Also update `packages/database/package.json`'s `migrate:local`/`migrate:remote` scripts if you
chose a database name other than the example above — they reference the D1 database by name,
matching whatever you set in `wrangler.toml`.

## 5. Set secrets

```bash
cd apps/api
wrangler secret put BETTER_AUTH_SECRET   # any long random string — never commit this
```

Local dev also needs `.dev.vars` (copy `.dev.vars.example`) — it overrides both `[vars]` and
secrets during `wrangler dev`, so your local `BETTER_AUTH_SECRET` can differ from the deployed
one.

## 6. Run migrations and deploy

```bash
pnpm --filter @kenresoft/database migrate:remote
pnpm --filter @kenresoft/api deploy
```

The first request to your deployed Worker's sign-up page becomes the admin account
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

`apps/admin` has no first-class deploy target yet — the documented workaround today is running
it locally against your deployed API (see the root `README.md`'s "Live deployment" section).
Deploying it to Cloudflare Pages as a static SPA works the same way as the marketing site above
(`pnpm --filter @kenresoft/admin build`, then `wrangler pages deploy dist`), but isn't wired
into `deploy.yml` yet.

## Automated deploys via GitHub Actions (optional)

`.github/workflows/deploy.yml` can deploy the API worker and marketing site on every push to
`main`, but is inert by default — every job is gated on a repository variable, so forking this
repo never risks an accidental deploy attempt against secrets you haven't set.

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
| `PUBLIC_KENRESOFT_CMS_URL` | Your deployed API's public URL, baked into the marketing site build. |
| `CLOUDFLARE_PAGES_PROJECT` | The Pages project name from step 7. |

Using a GitHub [Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
named `production` (both deploy jobs already declare `environment: production`) lets you add
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
binary, `docs/ARCHITECTURE.md` §9/§14): there's no equivalent single-command bucket export.
R2 is S3-API-compatible, so an S3-aware sync tool (e.g. `rclone`) pointed at your bucket's S3
endpoint (from the Cloudflare dashboard → R2 → your bucket → Settings) is the practical way to
mirror it somewhere else. This is a real, currently-open gap for this project — there's no
scripted or scheduled R2 backup shipped here yet, just the mechanism to build one on.
