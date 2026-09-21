# Changelog

User-facing changes to Kenresoft CMS, for anyone running an existing deployment who wants to know
what changed before running `pnpm run update` (see `docs/DEPLOYMENT.md`'s "Updating an existing
install" section). This starts here rather than reconstructing the project's full history:
see `git log` for everything before this file existed.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Dates are when a change
landed on `develop`.

## Unreleased

### Added

- `@kenresoft-cms/astro`: a generic `client.auth` API (sign up/in/out, session, email verification, password reset/change, two-factor) over Core's existing better-auth and password-reset routes. `commerce.customerAuth` now delegates to it. `KenresoftApiError` gained an optional `code`; the client gained a `cookies` option for SSR and `commerce.customerAuth.verifyTwoFactor()`. New `createCmsProxy()` same-origin proxy (recommended: makes the session cookie first-party so SSR and third-party-cookie-blocking browsers work on any domain layout). The API gained an opt-in `TRUSTED_PROXY_SECRET` so per-IP rate limits still see real visitors behind a proxy; unset, behavior is identical. Package version 0.5.0. No database or database changes.

### Breaking

- **One identity system for the CMS and its plugins.** Website/application users are now ordinary accounts with no CMS access (new role `none`), and new accounts default to it. **Before this, a public sign-up defaulted to Editor** — after updating, sign-ups get no CMS access; only an Owner/Admin can grant a role. Existing users keep their roles.
- **Commerce customers moved onto the core accounts.** `pnpm run update` migrates existing customers (same password, same orders/carts/addresses). Their old sessions end, so they sign in once more, and a customer must verify their email before signing in. The storefront `/customer-auth/*` routes are gone: use `/api/v1/auth/*` and `/api/v1/public/password-reset/*` (`@kenresoft-cms/astro`'s `commerce.customerAuth` does this for you; `register()` no longer signs the customer in).
- **The Owner is hidden from other users**: not in the Users list or audit log for anyone else, and looking up or changing the Owner as a non-Owner is a 404.

### Security

- **Rich text page blocks are now sanitised** on save and on every public read (and reusable
  Rich text blocks too). Previously an editor could store a `<script>` there. Task-list checkboxes
  in a Rich text *block* are dropped as a result.
- **Entry `rich_text` fields are now sanitised** the same way: on every write (create, update,
  import, restore) and on every admin and public read, so older stored values are cleaned too. Only
  fields of type rich_text are touched. Task-list checkboxes are dropped.
- HTML sanitiser: work limit against crafted input that took ~60s of CPU, and a nesting cap of 100.
- Email subjects with line breaks are rejected (header injection).
- Raw HTML permission is checked before any sanitising work.
- Admin email sending is rate limited to 10 per minute per staff user. This adds an
  `ADMIN_EMAIL_RATE_LIMITER` binding to `wrangler.toml`; it is created on your next deploy.

### Fixed

- Signing up with an email that already has an account no longer returns a server error.
- Email page: Reply-To can be set (it was always the sender's own address); Email sender card now
  comes first; long rich-text bodies scroll inside the editor instead of stretching the page.
- Media picker thumbnails no longer overlap.

### Added

- **Design HTML** format on the Email page (admin/owner only): paste a finished HTML email template
  (for example from Canva) and send it with its table layout, inline styles and https images kept,
  with a sandboxed preview of exactly what will be sent and an automatic plain-text version.
  Scripts, forms, `<style>` blocks, relative links and `data:` images are removed.
- A **Raw HTML block** for pages: paste HTML and see a preview of exactly what will be published.
  Off by default (Settings → API), admin/owner-only, sanitized on the server on every save and
  every public read, and switching it off hides every raw block immediately. See
  `docs/RAW_HTML_BLOCK.md`. Requires `pnpm run update` (no migration) and republishing
  `@kenresoft-cms/contracts` for standalone admin installs.
- Fixed: the shared link check now rejects `javascript:` URLs hidden with tab/newline characters
  (also hardens form-submission replies).
- A **preferred mail client** setting on Profile (Default/Gmail/Outlook/Yahoo/Zoho). The
  "Reply in email app" action on a form submission now opens that provider's own web compose
  window (pre-filled to/subject) instead of always falling back to the OS's default `mailto:`
  handler, unless "Default" is selected.
- **Reply directly from the CMS**: a submission's detail view (now a wide, roomier side panel
  rather than a small dialog) includes a rich-text reply composer and a visible thread of every
  past reply sent from the admin for that submission. Persisted server-side
  (`form_submission_replies`), sent through the deployment's already-configured email provider
  with `Reply-To` set to the replying staff member's own address so a further reply from the
  visitor lands somewhere monitored. Requires an email provider to be configured
  (`EMAIL_PROVIDER`); replying is otherwise disabled with an explanation.
- Fixed: multi-line/paragraph text submitted through a textarea field displayed as a single
  flattened line in the admin submission viewer (whitespace/line breaks were being collapsed by
  default text wrapping). Formatting is now preserved.
- `@kenresoft-cms/astro` 0.4.0: `createKenresoftClient({ previewToken })` binds a client to one
  request's Live Preview session. Every `entries.get()`/`pages.resolve()` call made through it
  picks up that token automatically, with no `?preview_token=` handling in the page itself. Paired
  with the new `getPreviewToken(input)` helper (accepts `Astro.url`, an absolute URL string, or
  `Astro.request`) and Astro middleware storing the client on `context.locals.cms`, this makes
  Live Preview work across an entire site for free. The actual "handle it from the published
  package, not per-page" version of 0.3.0's `previewToken` option below. `examples/astro-site`
  (`blog/[slug].astro`, `[...route].astro`) and the `npm create @kenresoft-cms@latest ... --astro`
  starter (a new `src/middleware.ts`) were both updated to this pattern. Fixed along the way: a
  real bug in `[...route].astro`'s Page-preview handling. Resolving a Page's route against
  `cms.pages.list()` *before* checking for a preview token meant a **draft** Page's route (never
  in that published-only list) 404'd before the preview branch could ever run, defeating Live
  Preview for exactly the case it exists for. Published-Page preview and every entry preview were
  unaffected. See `integrations/astro/README.md`'s "Live Preview (draft rendering)" section.
- `@kenresoft-cms/astro` 0.3.0: `entries.get()`/`pages.resolve()` now accept an optional
  `previewToken`. Pass `Astro.url.searchParams.get('preview_token')` (the param Kenresoft CMS's
  Live Preview button appends) straight through and they transparently render a draft/any-status
  entry or Page through the same call, no separate `entries.preview()`/`pages.preview()` branch
  needed in your own templates. Previously, getting Live Preview working in your own Astro site
  meant hand-writing that branch yourself, easy to skip on any page that wasn't the one template
  this was first demonstrated on. `npm create @kenresoft-cms@latest my-site -- --astro`'s
  `blog/[slug].astro` template was updated to use it (0.2.2), so a freshly scaffolded starter has
  working Live Preview out of the box. See `integrations/astro/README.md`'s "Live Preview (draft
  rendering)" section. Update an existing project with `pnpm add @kenresoft-cms/astro@latest` (or
  `npm install`/`yarn add` the same way). Plain `pnpm update @kenresoft-cms/astro` won't reach
  0.3.0 from an existing `^0.2.0` dependency range; a caret range on a 0.x package only resolves
  within its own minor version, so crossing 0.2→0.3 needs `@latest` (or an equivalent explicit
  version), not a bare update.
- `@kenresoft-cms/astro` is now published on npm, `npm install @kenresoft-cms/astro` works
  directly in your own, separately-hosted Astro project against your own CMS deployment; it
  previously had to be copied or vendored by hand. See `integrations/astro/README.md`'s
  "Connecting your own Astro project" section and `docs/ASTRO.md`.
- `npm create @kenresoft-cms@latest my-site -- --astro` scaffolds a small, generic Astro starter
  wired up to `@kenresoft-cms/astro` (published dependency, no monorepo). For anyone who already
  has a CMS deployment and just wants a frontend, without cloning the whole CMS or adapting
  `examples/astro-site`'s much larger, Commerce-specific reference site. See
  `packages/create/README.md`.
- `pnpm run update -- --domain` (and the equivalent menu entry in `pnpm run setup`) connects a
  custom domain to the API Worker without touching the Cloudflare dashboard: it writes a
  `[[routes]]` entry (`custom_domain = true`) and redeploys, which makes Cloudflare create the
  DNS record and route for you. Disabling the `*.workers.dev` fallback URL afterward is a
  separate, explicit confirmation (default: leave it enabled). Connect and verify the custom
  domain first, then come back and turn off the fallback once you're sure it works.
  `pnpm run update -- --admin-domain` does the same for the Admin Worker's own, separate
  `wrangler.toml`, and additionally refreshes the `ADMIN_URL` secret (used to build every
  password-reset/verification email link) to match. Nothing else keeps that in sync
  automatically.
- **Structured Settings**: a new configuration primitive for singleton, typed site config
  (General/Contact/Social/Navigation/Footer/SEO), distinct from both Content Types/Entries and
  Global Variables (`docs/ARCHITECTURE.md` §6.2 explains when to use which). Settings → Social
  is now a real editor again instead of a redirect to Global Variables, and Contact/Navigation/
  Footer/SEO sections are new. Publicly readable, per module at
  `GET /api/v1/public/settings/:module` (deliberately not edge-cached, see Fixed below);
  `@kenresoft-cms/astro` gained a matching
  `cms.settings.general()/.contact()/.social()/.navigation()/.footer()/.seo()`. Requires the new
  database migration (`0032_talented_outlaw_kid.sql`) via `pnpm run update`. If you were already
  using Global Variables for site config (`site_name`, `tagline`, `contact_email`/`phone`/
  `address`, `social_*`, `footer_copyright`), a one-time "Import into Structured Settings" button
  on the Global Variables page copies those known keys into the matching module. Nothing is
  deleted or overwritten automatically, and it's safe to run more than once.
- Audit log. Content, structural, and auth activity (entry/content-type/field/form/media
  create/update/delete/publish/unpublish, sign-up/in/out, failed sign-ins) is now recorded and
  browsable from a new Audit log page (admin/owner only). Requires the new database migration
  (`0019_warm_stranger.sql`) via `pnpm run update`.
- Live Preview. A new "Live Preview" button on the Entry Editor opens a draft (or any-status)
  entry rendered through your actual frontend's real templates, via a signed, time-limited,
  single-entry preview link. Configure your frontend's URL pattern in Settings → API → Live
  Preview (`{contentType}`/`{slug}` placeholders). The normal public API's "drafts 404 exactly
  like a nonexistent slug" behavior is unchanged. Requires the new database migration
  (`0020_slim_swarm.sql`) via `pnpm run update`. The `@kenresoft-cms/astro` client (not
  independently published, pull this repo's changes to pick it up) gained a matching
  `entries.preview()` method, and `examples/astro-site`'s blog page shows how to wire it up.

- Forms now support **email notifications on submission**: a form gains an optional
  `notificationEmails` list (set on it via Forms → a form → Edit form). Leave it blank for no
  change in behavior, or add one or more addresses to get emailed (subject, field labels/values,
  and a link into the admin) every time that form is submitted. Reuses whatever `EMAIL_PROVIDER`
  a deployment already has configured (Resend, Cloudflare, or none). No new email setup needed.
  Requires the new database migration (`0040_dazzling_union_jack.sql`) via `pnpm run update`.
- Submissions tables (per-form and the unified "All submissions" view) gained an attachments
  indicator (a paperclip + count, hover for filenames) so a form with file uploads. A résumé on
  a Job Application form, for example. Is scannable without opening every row, and a "Reply by
  email" quick action on any submission with a recognizable sender email.

### Changed

- **`examples/astro-site` is no longer presented (or wired up) as something you deploy.** It was
  previously documented as an optional "marketing site" with real `wrangler pages deploy`
  instructions and a `deploy-marketing-site` job in `.github/workflows/deploy.yml`. Both
  removed. It's an illustrative reference implementation that proves the public API/SDK surface
  works end to end (Commerce checkout included), not a starter meant to be forked or run in
  production; there was never an update mechanism for it either way. If your fork had
  `DEPLOY_ENABLED=true` with `PUBLIC_KENRESOFT_CMS_URL`/`CLOUDFLARE_PAGES_PROJECT` set expecting
  this job to run, it no longer will. Those variables are now unused. To build a real frontend,
  use `npm create @kenresoft-cms@latest my-site -- --astro` (see `docs/DEPLOYMENT.md` §7)
  instead, a genuine minimal starter meant to be built on and deployed however you choose.
- **Breaking, has a migration**: staff accounts must now verify their email address before they
  can sign in. A real security gap closed (a newly created account, including one created via
  `Admin → Users → Add user`, could previously sign in with its temporary/chosen password with
  no proof of email ownership at all). New accounts (self-signup or Add User) receive a real
  verification email; the first-ever signup on a fresh deployment gets no exception. The new
  migration (`0034_grandfather-verified-users.sql`, applied via `pnpm run update`) marks every
  account that already existed as verified, so nobody on an existing deployment is locked out:
  only accounts created after you update are affected. `Admin → Users` now shows an "Unverified"
  badge on any account still awaiting this. See `docs/DEPLOYMENT.md`'s "Account verification,
  password recovery & owner recovery" section for how to verify your own account if you haven't
  configured email delivery yet.
- **Breaking, has a migration**: `Settings.contactEmail`/`Settings.socialLinks` are removed:
  they had no public route of their own and fully duplicated what Global Variables already does
  (public, edge-cached, arbitrary keys, and a "Site Info" template covering exactly this). The
  new migration (`0024_volatile_spiral.sql`, applied via `pnpm run update`) migrates any existing
  value automatically rather than dropping it: a non-null `contactEmail` becomes a
  `contact_email` Global Variable, and each key in `socialLinks` becomes `social_<key>`. Skipped
  if you already have a variable with that exact key, so nothing you'd already set gets
  overwritten. Settings → Social in the admin now points at Global Variables instead of
  duplicating it. If a frontend was reading these fields directly from `GET
  /api/v1/admin/settings`, switch it to `GET /api/v1/public/global-variables`
  (`globalVariables.list()` on the `@kenresoft-cms/astro` client) instead. See
  `docs/ASTRO.md`'s "Where public site config lives".
- Form submissions can now be deleted from the admin. A new `DELETE
  /api/v1/admin/forms/:id/submissions/:submissionId` route (admin/editor gated, audit-logged),
  with a delete action (single-row and bulk) on both the per-form and unified Submissions pages.
  The submissions table also gained a "Submitted by" column, derived from each submission's own
  data (matching common field-name spellings like `name`/`email`) so the sender is visible
  without opening every row individually, and rows are now clickable anywhere to open the preview
  instead of only the exact date text.

### Fixed

- **A live deployment could run in production with no `BETTER_AUTH_SECRET` set at all, silently**.
  Reported directly by an operator who found only two of the three expected secrets on their
  live Worker via `wrangler secret list`. better-auth's own "you are using the default secret"
  guard only throws under `NODE_ENV=production`, which is never true in a Cloudflare Worker, so a
  missing/default secret used to mean every session got signed with better-auth's publicly known
  default with no exception or log line anywhere. The API Worker now refuses to start auth at all
  (every session-touching request fails loudly, visible via `wrangler tail`) unless
  `BETTER_AUTH_SECRET` is set to a real, non-default value. `GET /api/v1/system/status` also
  gained an `authSecretConfigured` field (shown on Settings → API) so this can be checked without
  Cloudflare CLI access.
- **The documented unrelated-histories reconciliation merge (`pnpm run update` on an install
  scaffolded before `packages/create` switched to a real `git clone`) could silently overwrite a
  live deployment's own `wrangler.toml` values with the generic template's placeholders**:
  reported by an operator whose `database_id`/`bucket_name`/`BETTER_AUTH_URL`/custom-domain
  `[[routes]]` were all replaced with no conflict marker to catch it. The merge's `-X theirs`
  strategy resolves `wrangler.toml` the same as every other file. As one whole-file add/add
  conflict, since there's no common ancestor to 3-way-diff against. Which only stayed safe as
  long as this install's real values were purely uncommitted (and therefore separately stashed);
  committing them at any point, which this project's own git conventions otherwise encourage, was
  enough to lose them for real. `wrangler.toml` is now explicitly restored to this install's own
  pre-merge committed content immediately after that one-time reconciliation merge, regardless of
  whether the values were committed or just stashed. `pnpm run update`'s "not set up yet" error
  (triggered downstream once `database_id` goes missing) now also explains this possibility and
  points at recovering from `git log` instead of re-running `setup`, which would provision new
  resources rather than recovering the old ones.
- **A successful `pnpm run update`/`setup` redeploy could look broken for a few minutes**:
  Cloudflare's edge cache for a Workers Static Assets site doesn't invalidate `index.html`
  instantly, so the live admin site could briefly keep serving an HTML shell referencing a JS
  bundle hash from before the deploy (self-correcting with no action needed). Both scripts now
  print a note explaining this immediately after redeploying the admin app, and
  `docs/DEPLOYMENT.md`'s update section documents it too.
- **Live Preview 404ing every draft under static Astro output**: reported by developers building
  their own site on `@kenresoft-cms/astro`. Root cause was never a CMS/SDK bug: under Astro's
  default `output: 'static'` with `getStaticPaths()`, a dynamic route only gets a real page for
  the params `getStaticPaths()` returned at build time. A draft's slug is essentially never one
  of them (most `getStaticPaths()` implementations, including this project's own historical one,
  only list published entries), so Astro 404s the request itself before any page code (including
  the `previewToken` handling added above) ever runs. Fixed by documenting the actual
  requirement plainly, in the place developers actually see it, `integrations/astro/README.md`'s
  "Live Preview" section now has a prominent warning with the fix
  (`export const prerender = false;` on the one page that needs it, no adapter/output change for
  the rest of your site). And by adding that line, with an explanatory comment, to the
  `npm create @kenresoft-cms@latest ... --astro` starter's `blog/[slug].astro` so a fresh scaffold
  never regresses into this even if someone later switches the site to static output. See
  `docs/ASTRO.md`'s "Live Preview requires the page to render on demand" section for the full
  explanation. `@kenresoft-cms/create` bumped to 0.2.3 for the template fix.
- `npm create @kenresoft-cms@latest <path> -- --astro` (and the full-CMS scaffold mode) failed to
  scaffold into an absolute target path, concatenating it onto the current directory instead of
  using it directly (`path.join()` has no special handling for an already-absolute second
  argument, unlike `path.resolve()`, which the scaffold now uses). A plain relative name, the
  documented usage, was unaffected.
- `pnpm run update` (and the equivalent `pnpm run setup` redeploy path) threw "Could not find the
  deployed Worker URL" on every run once a Worker's `*.workers.dev` route was disabled. Even
  though the deploy itself succeeded. `wrangler deploy`'s own output only ever prints a
  `*.workers.dev` line when that route is enabled; disabling it (e.g. via the new `--domain`
  command above) left nothing for the old extraction logic to match. It now also recognizes a
  `<domain> (custom domain)` line, falling back to that when no `*.workers.dev` line is present.
- Connecting a custom domain to the Admin Worker never refreshed the `ADMIN_URL` secret (used to
  build every password-reset/verification email link). It stayed pinned to whatever
  `*.workers.dev` URL the very first `pnpm run setup` run happened to set it to. The new
  `--admin-domain` command above fixes this going forward.
- `pnpm run update -- --auth`, once it actually changed `BETTER_AUTH_URL` and tried to rebuild the
  admin app against the new value, threw a `ReferenceError` (an internal variable was never passed
  into the function that needed it).
- `pnpm run setup`/`update` always built the admin app against the raw `*.workers.dev` URL
  `wrangler deploy` prints, even when `BETTER_AUTH_URL` already held a real custom domain. The
  two could silently drift apart. If the `*.workers.dev` route was ever disabled (e.g. after
  connecting a custom domain and turning off the fallback), the already-deployed admin app broke
  outright, since it was still calling the now-unreachable workers.dev URL. Now prefers
  `BETTER_AUTH_URL` whenever it's a real, non-placeholder value, falling back to the deployed
  workers.dev URL only on a fresh install with no custom domain configured yet; changing the
  Better Auth URL via `pnpm run update -- --auth` now also rebuilds and redeploys the admin app
  so the two can't drift apart again. Also fixed: connecting a custom domain via `[[routes]]`
  silently disabled the `*.workers.dev` fallback as an unrelated side effect once any route
  existed (Cloudflare's actual default here differs from its own docs, which claim
  `workers_dev` defaults to enabled unconditionally). The new `--domain` command above always
  writes `workers_dev` explicitly instead of leaving it implicit.
- Structured Settings changes (site navigation, footer, etc.) sometimes never showed up on the
  public site even after a successful save and a hard reload. Cause: `GET /api/v1/public/
  settings/:module` used the Cloudflare Cache API for edge caching, but that cache is per-data-
  center. Invalidating it on save only clears the one data center that handled the write, so
  any other data center already serving a cached copy kept doing so for up to its own 5-minute
  TTL. Fixed by no longer caching this route at all. It's read once per page render (low
  traffic) and is admin-edited config an editor expects to see change everywhere immediately, so
  correctness wins over the saved D1 read.
- The "Purge Cache" admin button (Settings → API) could fail outright with "Too many subrequests
  by single Worker invocation" once a deployment had enough published entries/media. It deleted
  every cache key in one big parallel sweep, which can exceed a Worker invocation's subrequest
  budget (50 on Cloudflare's Free plan). The same unbounded-sweep pattern also affected bulk
  entry import and the scheduled auto-publish sweep, just needing more items to trigger. All
  three now enqueue their cache keys into a new, resumable purge queue and drain it in small,
  bounded batches. One immediately, the rest automatically over the next few 5-minute Cron
  Trigger ticks for an unusually large catalog. See `docs/ARCHITECTURE.md` §12. Requires the new
  database migration (`0033_blue_wilson_fisk.sql`) via `pnpm run update`.
- `pnpm run update` now pulls the latest code itself (from the `upstream` git remote) as its
  first step, instead of assuming you'd already run `git fetch`/`git merge` by hand. It's a
  genuine single command now. `npm create @kenresoft-cms@latest` also now scaffolds via a real
  `git clone` (keeping actual commit history) instead of a tarball download, so future updates
  merge cleanly; an install scaffolded before this change gets a one-time, explicitly-confirmed
  reconciliation the first time it updates.
- Two-factor enrollment failed for everyone on a fresh install (`BetterAuthError: The field
  "verified" does not exist...`). The `two_factor` table was missing three columns better-auth
  1.7's plugin requires. Requires the new database migration (`0021_bitter_jubilee.sql`) via
  `pnpm run update`.
- A rate-limited request to any `/api/v1/auth/*` action (sign-in, sign-up, two-factor, password
  change) showed a misleading, action-specific error message (e.g. two-factor enrollment saying
  "check your password") instead of "too many requests". The rate limiter's error response
  didn't match the shape better-auth's client expects.
- `pnpm run setup`'s Resend email setup silently never activated `EMAIL_PROVIDER`. Your API key
  got saved, but the app kept using the no-op sender regardless.
- A webhook whose endpoint doesn't handle POST requests properly could get stuck retrying the
  same failed delivery forever (throwing every 5 minutes) instead of giving up after 5 attempts.
- Dependency security updates: `better-auth` 1.4.21 → 1.7.2, `astro`/`@astrojs/cloudflare`
  (example site) to their current majors, `wrangler` and `@cloudflare/workers-types` bumped
  everywhere, plus `qs`/`esbuild` pinned to safe versions via `pnpm` overrides where an
  unfixed transitive dependency (drizzle-kit, shadcn's bundled tooling) hadn't caught up yet.
  Requires running the new database migration (`0018_glamorous_leper_queen.sql`, better-auth
  1.7 scopes account identity by `(issuer, accountId)`, not `accountId` alone) via `pnpm run
  update`.
- `pnpm run setup` no longer silently regenerates `BETTER_AUTH_SECRET` (logging out every current
  user) when re-run against an already-configured deployment. It now checks first and asks
  before rotating.
- `pnpm run setup` now confirms a D1 database/R2 bucket referenced in `wrangler.toml` still
  actually exists on Cloudflare before skipping its provisioning step, instead of trusting that a
  `database_id`/`bucket_name` already being present in the config means the resource is still
  there. Recreates it if it was deleted out-of-band.
- `apps/admin`'s production bundle dropped from one shared 1.9MB chunk to a 351kB shell plus small
  per-page chunks, via route-based code splitting. Most pages now download only a few kB.

### Added

- Entry export/import. Export every entry for a content type as a portable JSON file, and
  re-import it (creating new entries or updating existing ones by slug) into the same or another
  deployment, from the Entries page's new Export/Import buttons.
- `pnpm run update`: redeploys an existing install with new code (install, migrate, redeploy
  both Workers) without touching secrets, D1/R2 resources, or CORS config, unlike `pnpm run
  setup`. This is the command to run for an update instead.
- `npm create @kenresoft-cms@latest`: scaffolds a new install without `git clone`; the scaffolded
  repo now also gets an `upstream` git remote and an initial commit so `git fetch upstream && git
  merge upstream/<branch>` can pull in future updates.
- `@kenresoft-cms/contracts` and `@kenresoft-cms/create` published to npm (`@kenresoft-cms` scope,
  distinct from the general `@kenresoft` company scope). The former is what makes the Admin
  Worker installable as a standalone Cloudflare Worker at all.
- Rate limiting on the public content/media API (`PUBLIC_CONTENT_RATE_LIMITER`, 300 requests/60s
  per IP). Previously only forms, auth, and recovery routes were protected.
- Two-factor authentication (TOTP + backup codes). Enable it per-account from Profile → Security.
  Requires running the new database migration (`0016_green_franklin_richards.sql`) via `pnpm run
  update` or `pnpm --filter @kenresoft-cms/database migrate:remote`.
- Webhooks. Configure them from Settings → Webhooks. Fires a signed (`X-Kenresoft-Signature`,
  HMAC-SHA256) POST request to a URL you provide whenever an entry is created, updated,
  published, unpublished, or deleted, optionally scoped to one content type. Failed deliveries
  retry automatically (up to 5 attempts) on the existing 5-minute scheduled-publishing cron.
  Requires running the new database migration (`0017_lovely_shriek.sql`) via `pnpm run update`.
