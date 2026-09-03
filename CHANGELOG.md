# Changelog

User-facing changes to Kenresoft CMS, for anyone running an existing deployment who wants to know
what changed before running `pnpm run update` (see `docs/DEPLOYMENT.md`'s "Updating an existing
install" section). This starts here rather than reconstructing the project's full history —
see `git log` for everything before this file existed.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Dates are when a change
landed on `develop`.

## Unreleased

### Fixed

- `pnpm run setup` no longer silently regenerates `BETTER_AUTH_SECRET` (logging out every current
  user) when re-run against an already-configured deployment — it now checks first and asks
  before rotating.
- `apps/admin`'s production bundle dropped from one shared 1.9MB chunk to a 351kB shell plus small
  per-page chunks, via route-based code splitting — most pages now download only a few kB.

### Added

- `pnpm run update` — redeploys an existing install with new code (install, migrate, redeploy
  both Workers) without touching secrets, D1/R2 resources, or CORS config, unlike `pnpm run
  setup`. This is the command to run for an update instead.
- `npm create @kenresoft-cms@latest` — scaffolds a new install without `git clone`; the scaffolded
  repo now also gets an `upstream` git remote and an initial commit so `git fetch upstream && git
  merge upstream/<branch>` can pull in future updates.
- `@kenresoft-cms/contracts` and `@kenresoft-cms/create` published to npm (`@kenresoft-cms` scope,
  distinct from the general `@kenresoft` company scope) — the former is what makes the Admin
  Worker installable as a standalone Cloudflare Worker at all.
- Rate limiting on the public content/media API (`PUBLIC_CONTENT_RATE_LIMITER`, 300 requests/60s
  per IP) — previously only forms, auth, and recovery routes were protected.
- Two-factor authentication (TOTP + backup codes) — enable it per-account from Profile → Security.
  Requires running the new database migration (`0016_green_franklin_richards.sql`) via `pnpm run
  update` or `pnpm --filter @kenresoft-cms/database migrate:remote`.
- Webhooks — configure them from Settings → Webhooks. Fires a signed (`X-Kenresoft-Signature`,
  HMAC-SHA256) POST request to a URL you provide whenever an entry is created, updated,
  published, unpublished, or deleted, optionally scoped to one content type. Failed deliveries
  retry automatically (up to 5 attempts) on the existing 5-minute scheduled-publishing cron.
  Requires running the new database migration (`0017_lovely_shriek.sql`) via `pnpm run update`.
