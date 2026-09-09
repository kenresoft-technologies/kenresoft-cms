# Changelog

User-facing changes to Kenresoft CMS, for anyone running an existing deployment who wants to know
what changed before running `pnpm run update` (see `docs/DEPLOYMENT.md`'s "Updating an existing
install" section). This starts here rather than reconstructing the project's full history —
see `git log` for everything before this file existed.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Dates are when a change
landed on `develop`.

## Unreleased

### Added

- Audit log — content, structural, and auth activity (entry/content-type/field/form/media
  create/update/delete/publish/unpublish, sign-up/in/out, failed sign-ins) is now recorded and
  browsable from a new Audit log page (admin/owner only). Requires the new database migration
  (`0019_warm_stranger.sql`) via `pnpm run update`.
- Live Preview — a new "Live Preview" button on the Entry Editor opens a draft (or any-status)
  entry rendered through your actual frontend's real templates, via a signed, time-limited,
  single-entry preview link. Configure your frontend's URL pattern in Settings → API → Live
  Preview (`{contentType}`/`{slug}` placeholders). The normal public API's "drafts 404 exactly
  like a nonexistent slug" behavior is unchanged. Requires the new database migration
  (`0020_slim_swarm.sql`) via `pnpm run update`. The `@kenresoft-cms/astro` client (not
  independently published — pull this repo's changes to pick it up) gained a matching
  `entries.preview()` method, and `examples/astro-site`'s blog page shows how to wire it up.

### Changed

- **Breaking, has a migration**: `Settings.contactEmail`/`Settings.socialLinks` are removed —
  they had no public route of their own and fully duplicated what Global Variables already does
  (public, edge-cached, arbitrary keys, and a "Site Info" template covering exactly this). The
  new migration (`0024_volatile_spiral.sql`, applied via `pnpm run update`) migrates any existing
  value automatically rather than dropping it: a non-null `contactEmail` becomes a
  `contact_email` Global Variable, and each key in `socialLinks` becomes `social_<key>` — skipped
  if you already have a variable with that exact key, so nothing you'd already set gets
  overwritten. Settings → Social in the admin now points at Global Variables instead of
  duplicating it. If a frontend was reading these fields directly from `GET
  /api/v1/admin/settings`, switch it to `GET /api/v1/public/global-variables`
  (`globalVariables.list()` on the `@kenresoft-cms/astro` client) instead — see
  `docs/ASTRO.md`'s "Where public site config lives".

### Fixed

- `pnpm run update` now pulls the latest code itself (from the `upstream` git remote) as its
  first step, instead of assuming you'd already run `git fetch`/`git merge` by hand — it's a
  genuine single command now. `npm create @kenresoft-cms@latest` also now scaffolds via a real
  `git clone` (keeping actual commit history) instead of a tarball download, so future updates
  merge cleanly; an install scaffolded before this change gets a one-time, explicitly-confirmed
  reconciliation the first time it updates.
- Two-factor enrollment failed for everyone on a fresh install (`BetterAuthError: The field
  "verified" does not exist...`) — the `two_factor` table was missing three columns better-auth
  1.7's plugin requires. Requires the new database migration (`0021_bitter_jubilee.sql`) via
  `pnpm run update`.
- A rate-limited request to any `/api/v1/auth/*` action (sign-in, sign-up, two-factor, password
  change) showed a misleading, action-specific error message (e.g. two-factor enrollment saying
  "check your password") instead of "too many requests" — the rate limiter's error response
  didn't match the shape better-auth's client expects.
- `pnpm run setup`'s Resend email setup silently never activated `EMAIL_PROVIDER` — your API key
  got saved, but the app kept using the no-op sender regardless.
- A webhook whose endpoint doesn't handle POST requests properly could get stuck retrying the
  same failed delivery forever (throwing every 5 minutes) instead of giving up after 5 attempts.
- Dependency security updates: `better-auth` 1.4.21 → 1.7.2, `astro`/`@astrojs/cloudflare`
  (example site) to their current majors, `wrangler` and `@cloudflare/workers-types` bumped
  everywhere, plus `qs`/`esbuild` pinned to safe versions via `pnpm` overrides where an
  unfixed transitive dependency (drizzle-kit, shadcn's bundled tooling) hadn't caught up yet.
  Requires running the new database migration (`0018_glamorous_leper_queen.sql` — better-auth
  1.7 scopes account identity by `(issuer, accountId)`, not `accountId` alone) via `pnpm run
  update`.
- `pnpm run setup` no longer silently regenerates `BETTER_AUTH_SECRET` (logging out every current
  user) when re-run against an already-configured deployment — it now checks first and asks
  before rotating.
- `pnpm run setup` now confirms a D1 database/R2 bucket referenced in `wrangler.toml` still
  actually exists on Cloudflare before skipping its provisioning step, instead of trusting that a
  `database_id`/`bucket_name` already being present in the config means the resource is still
  there — recreates it if it was deleted out-of-band.
- `apps/admin`'s production bundle dropped from one shared 1.9MB chunk to a 351kB shell plus small
  per-page chunks, via route-based code splitting — most pages now download only a few kB.

### Added

- Entry export/import — export every entry for a content type as a portable JSON file, and
  re-import it (creating new entries or updating existing ones by slug) into the same or another
  deployment, from the Entries page's new Export/Import buttons.
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
