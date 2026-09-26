# Changelog

User-facing changes to Kenresoft CMS, for anyone running an existing deployment who wants to know
what changed before running `pnpm run update` (see `docs/DEPLOYMENT.md`'s "Updating an existing
install" section). This starts here rather than reconstructing the project's full history:
see `git log` for everything before this file existed.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/), and releases follow
[semantic versioning](https://semver.org/) as described in `docs/RELEASING.md`. Each
`## [X.Y.Z] - date` section is one release, dated the day it was released; `## Unreleased` is what
the next release will contain.

## Unreleased

### Added

- **Numbered releases.** Kenresoft CMS now ships as versioned releases (`v0.9.0` onwards), each a git tag, a GitHub release and a section of this changelog. **Settings → Updates** shows the version a deployment runs and whether a newer release exists, and Admins and Owners see an "Update available" notice in the sidebar. The check asks GitHub from the API Worker, cached for hours; a fork can point it at its own repo, or turn it off, with the new optional `UPDATE_CHECK_REPO` variable. The running version is only shown to Admins and Owners, never on a public endpoint. Maintainers cut releases with `pnpm run release`; the version rules and process are in `docs/RELEASING.md`. Requires publishing `@kenresoft-cms/contracts` 0.6.2 (the version endpoint's schema).
- **Account-linked form submissions.** A form can now require a website account (Forms > Edit > "Require a website account"). Only a signed-in, verified account can submit it, and the submission belongs to that account. The owner is always taken from the session, never from the request. The account can then follow its own submissions from your site through a new account API, `/api/v1/account/forms/submissions`: list, detail, file downloads and messages. Another account's submission is always a 404. Anonymous forms work exactly as before.
- **Per-form progress stages.** A form can have its own ordered stages (for example Submitted, In Progress, Completed). New submissions start in the first stage. Staff move a submission along from its detail page (`PUT /api/v1/admin/forms/:id/submissions/:submissionId/stage`), which records the change in a history the owning account can see. A stage is separate from the inbox status (new/read/archived), which the account never sees. If the form has an "Account page URL", the owning account gets an email when the stage changes, through a new admin-editable template, **Request update (website account)**.
- **Two-way submission threads.** The owning account can post messages with up to 5 files (PDF, DOCX or image, 10 MB each) from your site, and the form's notification recipients are emailed. Staff replies still go out by email as before, and now also appear in the account's view of the submission, with a link back to it in the email when the form has an Account page URL. Staff see account messages in the submission's conversation.
- **Accepted files per file field.** A form's file field can be limited to PDF, Word (.docx) and/or images (Forms > field > "Accepted files", stored as `config: { accept: ['pdf', 'docx'] }`). The API checks the file's actual content against it, so a crafted request can't get around the browser's `accept` attribute. A field with nothing ticked accepts any supported file, as before.
- `@kenresoft-cms/astro` 0.8.0: `client.account.submissions` (`list`, `get`, `fileUrl`, `sendMessage`), `forms.submit()` accepts `FormData` (for file fields) and sends the session cookie, and the `/cms` proxy forwards `/api/v1/account/*`. Update with `npx @kenresoft-cms/create astro --update`. Requires publishing, in this order, `@kenresoft-cms/contracts` 0.6.0 (the new account submission types, and the form and reply schema changes, which 0.8.0 depends on), `@kenresoft-cms/astro` 0.8.0 and `@kenresoft-cms/create` 0.3.3.
- **"Only one featured entry" per content type.** A new switch on a content type (Content Types > a type > Edit) for a single spot such as a homepage hero. When it's on, featuring an entry un-features the one that was featured before, so a site asking for `?featured=true` always gets exactly one. The entry editor says so before you save. Turning it on while several entries are already featured keeps only the most recently updated one. Off, the default, allows any number of featured entries, as before. Only Admins and Owners can change it. Requires publishing `@kenresoft-cms/contracts` 0.6.1 (adds `singleFeatured` to the content type schema).

### Changed

- **`pnpm run update` now moves to the latest release instead of the tip of `develop`.** It prints what's new since your version, and does nothing but redeploy when you're already on the latest release. `pnpm run update -- --version 0.9.1` moves to a specific release. Following unreleased code is still possible for test installs with `--branch develop` or `UPDATE_BRANCH=develop`. It never downgrades; see "Rolling back" in `docs/RELEASING.md`. An install that was tracking `develop` is ahead of the first release and stays where it is until a release catches up with it.
- **A form submission with files is now all-or-nothing.** Files are stored before the submission is created, and if any file, the submission or its attachment links can't be saved, everything already stored is removed and the API answers 500 with nothing kept. Before, a file that failed to store was skipped and the submission was still reported as a success without it. Messages with files from an account follow the same rule. An uploaded Media object whose database row can't be written is also removed from R2 instead of being left behind.
- A file field no longer silently ignores an empty file someone actually picked: it's refused with "File is empty". A file input left blank still counts as no file. A macro-enabled Word document renamed to `.docx` is refused as unsupported.
- Admin: a submission on an account-only form whose website account was later deleted now says the account is no longer available, where replies go instead, and labels the account's earlier messages "Former website account". The submission, its files and its thread stay fully workable for staff.
- `npx @kenresoft-cms/create astro` managed files: the `/cms` proxy now reads `PUBLIC_KENRESOFT_CMS_URL` from the Worker's runtime variables first (on Node, the server's environment), then from the build. A site built without the variable, for example on a machine or Cloudflare Git build without it, no longer breaks every `/cms` call as long as the Worker has it at runtime. `src/lib/kenresoft.ts` marks its server client as pure, so a browser script that only imports `browserCms` no longer ships the API's address. Refresh with `npx @kenresoft-cms/create astro --update`.
- `@kenresoft-cms/astro`: `createCmsProxy` without a URL now logs what's missing and answers 503 instead of crashing (which Astro turned into a blank 404), and `createKenresoftClient` without a URL throws an error naming `PUBLIC_KENRESOFT_CMS_URL` instead of "Cannot read properties of undefined (reading 'replace')".
- Files attached to a staff reply are now kept as private Media, so the thread (and the owning account, for an account-linked submission) can download them later. Before, only their names were recorded and the file itself was only emailed. Older replies keep their name-only record. Deleting a submission also deletes these stored files.

### Migration

- `0056_account_linked_submissions.sql` adds `forms.requires_account` / `stages` / `account_submission_url`, `form_submissions.account_user_id` / `stage`, and a `form_submission_stage_changes` table. It also rebuilds `form_submission_replies` to add `direction` and make `to`/`subject` nullable. Every existing reply is copied across as an outbound reply, unchanged. No data backfill is needed: existing submissions have no owner and no stage, and no account can see them. Applied by `pnpm run update`.
- `0057_single_featured_content_types.sql` adds `content_types.single_featured`, off for every existing content type, so nothing changes until someone turns it on. Applied by `pnpm run update`.

### Fixed

- **A site's featured list now updates as soon as an entry is featured or un-featured.** The public `?featured=true` list was cached separately from the plain list and never cleared on save, so a change could take up to 5 minutes to show.
- **Checklists now show on one line on your site, whatever its CSS.** A saved checklist used to put the checkbox and the item's text in separate blocks, so a site without checklist-specific CSS (most sites) showed a bullet with the checkbox on one line and the text on the next. Checklists are now saved as `<li><input type="checkbox"> text</li>` in a list with bullets turned off, which renders correctly with no CSS. The checkbox also carries a small inline style so a site-wide `input { display: block; width: 100% }` rule can't push it onto its own line. Checklists saved before this update are served in the new shape too, since the API rewrites the old markup when it delivers content. You don't need to re-save anything. A published page may keep showing the old layout for up to 5 minutes after you update, until its edge-cached copy expires.
- **Checklists no longer disappear when an entry is saved.** The API's rich-text sanitizer removed the editor's checklist markup on every save, so a checklist came back as a plain bullet list, and a numbered list starting at 3 restarted at 1. It now keeps both, and every checkbox is stored as a disabled, display-only `<input type="checkbox">` with nothing else of the original tag kept. Any other kind of `<input>` is still removed, and email HTML is unchanged. The same applies to the Page RichText and Raw HTML blocks.
- **Markdown checkboxes in the rich-text editor.** `- [ ] item` / `- [x] item` written in Markdown mode now come back as a real checklist. Before, it only worked for a tight list: a blank line between items (common in blog posts), a numbered checklist (`1. [ ] step`), or a list mixing checkbox and plain items all lost their checkboxes. Plain GFM checkbox HTML pasted into HTML mode, or stored by the API or an entry import, is recognized too.
- **Switching to Markdown mode and back no longer changes the content.** Underline, highlight and text alignment were stripped (Markdown has no syntax for them, so they're now kept as inline HTML in the Markdown view), literal text like `<div>` was deleted, images picked up an empty paragraph, and code blocks grew a blank line each time.
- The Astro example's `RichText` component now styles checklists. If your site renders rich text with its own component, add equivalent CSS for `ul[data-type="taskList"]`/`li[data-type="taskItem"]` (see `examples/astro-site/src/components/cms/RichText.astro`), or checklist items show as a bullet with the checkbox and text on separate lines.
- `pnpm run update -- --admin-domain` now also migrates the API's `CORS_ORIGINS` allow-list, not just `ADMIN_URL` — connecting a custom domain to the Admin app previously left the *old* admin origin (and, until the very first run, no admin origin at all) in `CORS_ORIGINS` indefinitely, since nothing wired that up automatically. The old admin origin is now replaced in place with the new one; every unrelated origin (your public site, a staging origin, ...) is preserved untouched, and the API is redeployed only when `CORS_ORIGINS` actually changed. It still never touches `BETTER_AUTH_URL` (a separate, API-side concept — use `--auth` for that) and is safe to re-run: a second run with the same domain makes no further changes. If the Admin Worker's own deploy fails, nothing else is touched; if the follow-up API-side step fails, the command says so plainly ("Admin deployed, API configuration still pending") instead of claiming success. `pnpm run update -- --admin-domain --ci` (`ADMIN_CUSTOM_DOMAIN_NEW`) behaves identically. No action needed unless you're actively migrating the Admin app's domain, in which case just run the command as documented in `docs/DEPLOYMENT.md`.
- Fixed a real, reported incident in the CORS migration above: if the Admin Worker already had more than one custom domain connected (e.g. a previous manual edit, or an earlier partial migration attempt), the command always picked the *first* one as "the" old origin — a wrong guess in that situation could silently replace/remove a completely unrelated, still-in-use `CORS_ORIGINS` entry, which is what happened. It now never guesses when there's more than one candidate: it asks which one is being retired (interactively), or reads `ADMIN_OLD_DOMAIN_NEW` non-interactively; if left unresolved, it only *adds* the new origin and leaves every existing `CORS_ORIGINS` entry untouched. `replaceCorsOrigin` itself also gained a hard safety invariant — it now refuses to write a CORS_ORIGINS value that would drop any origin other than the one being intentionally replaced, as a last line of defense regardless of what a caller passes in. Also added: an optional, off-by-default step to remove the old `[[routes]]` entry from the Admin Worker once you've confirmed the new domain works (interactively; `REMOVE_OLD_ADMIN_DOMAIN=true` in CI) — closing the other half of the same report, where the old route was otherwise left behind indefinitely with no CLI path to clean it up. If you were affected by the CORS bug, re-check `CORS_ORIGINS` by hand; nothing here can recover an origin that's already been manually re-added.

### Changed

- The CMS now points to the official documentation at https://docs.kenresoft.com/cms: a Documentation item in the admin user menu, links on Settings > API and the email status message, docs links at the end of `pnpm run setup`, `pnpm run update` and `npx @kenresoft-cms/create astro`, and a docs banner on the README. Published `@kenresoft-cms/create` 0.3.1, `@kenresoft-cms/astro` 0.6.2 and `@kenresoft-cms/contracts` 0.5.1 carry the new help text and READMEs. The admin change needs `pnpm run update` to appear on an existing deployment.
- The GitHub Actions workflows now suit private deployments as well as this repository. CodeQL and Dependency Review run only on public repositories (on a private one they need GitHub Advanced Security and used to fail), and the full test suite runs only on public repositories or when the repository variable `RUN_FULL_TESTS` is `true`. Typecheck, lint and build still run everywhere. Tests now run one workspace package at a time, which avoids timeouts on small runners. No action needed on existing deployments.

### Fixed

- Settings > API's Turnstile status (and the "email delivery"/"auth secret" status cards next to it) could keep showing stale data — `GET /api/v1/system/status` was cached client-side with `staleTime: Infinity`, so a deployer who ran `pnpm run setup`/`update -- --turnstile` in another window while the admin tab stayed open kept seeing the old value until a hard reload. Now refetches after 30 seconds; no server-side change. No action needed.
- `pnpm run update -- --turnstile` (and the equivalent step in `pnpm run setup`) now redeploys the API whenever the Turnstile site key changes, and says so — it previously always claimed "took effect immediately, no redeploy needed," true for the secret (`wrangler secret put` applies to the live Worker right away) but not for `TURNSTILE_SITE_KEY`, a plain `wrangler.toml` var that only reaches the running Worker on the next deploy. Reported live: the CLI said the change applied, but `GET /api/v1/system/status` kept showing the site key as unset until a manual deploy. A secret-only change still needs no redeploy, as before. No action needed beyond re-running the command once on an already-updated deployment, to actually deploy the site key that was written but never pushed live.
- `@kenresoft-cms/astro` 0.6.1: the same-origin `/cms` proxy now drops a trailing slash before forwarding to the API. A site with Astro's `trailingSlash: 'always'` redirects `/cms/api/v1/...` to the slash form (a 308, even for POST), and the API returns 404 for paths with a trailing slash, so every browser call through the proxy, including sign-in, failed. Sites using Astro's default `trailingSlash` are unaffected. Update with `npx @kenresoft-cms/create astro --update`. Requires publishing a new `@kenresoft-cms/astro`.

### Added

- `pnpm run setup` and `pnpm run update -- --turnstile` now manage Cloudflare Turnstile end to end: prompt for (or, non-interactively, read `TURNSTILE_SECRET_KEY_NEW`/`TURNSTILE_SITE_KEY_NEW`/`TURNSTILE_DISABLE` for) both a `TURNSTILE_SECRET_KEY` Worker secret and a new `TURNSTILE_SITE_KEY` var — previously only the secret had a CLI path; the site key needed a manual `wrangler.toml` edit. `GET /api/v1/system/status` now returns `turnstileSiteKey` (not secret — safe to expose), and `@kenresoft-cms/astro` gained `system.status()` so a frontend can fetch it instead of needing its own `PUBLIC_TURNSTILE_SITE_KEY` copy. `examples/astro-site`'s register page and the `--astro` starter both do this by default now (an env var still works as a per-frontend override). Settings > API in the admin app shows whether a site key is configured. Package version `@kenresoft-cms/astro` 0.7.0, `@kenresoft-cms/create` 0.3.2 (the bundled `--astro` starter's dependency range moved to `^0.7.0`) — both need publishing. No database changes; nothing changes for a deployment that leaves Turnstile unconfigured.
- `npx @kenresoft-cms/create astro` connects an existing Astro project to a Kenresoft CMS (installs `@kenresoft-cms/astro`, adds the same-origin `/cms` proxy and client helpers, sets `PUBLIC_KENRESOFT_CMS_URL`), and `npx @kenresoft-cms/create astro --update` refreshes it. Only files marked `@kenresoft-managed` are written; edited ones are reported as conflicts, never overwritten. Requires publishing a new `@kenresoft-cms/create`. `pnpm run update` and `npm create @kenresoft-cms@latest` (including `--astro`) are unchanged.
- Content types can now be deleted (`DELETE /api/v1/admin/content-types/:id`, admin-only, a "Delete content type" button on the content type's Schema page). Its fields and entries cascade at the database level; the delete is blocked with a 409 if another content type still has a `reference` field targeting it (listing which field/content type), since that link is a plain JSON config value, not a real foreign key the database could otherwise enforce on its own. Recorded in the audit log as `content_type.deleted`. No database changes beyond the new route.
- **Transactional email templates.** Verification and password-reset emails are no longer hardcoded HTML in `apps/api/src/lib/auth.ts`/`routes/public/password-reset.ts` — a new **Email Templates** admin page (Settings-adjacent, admin-only) manages subject/HTML/plain-text for three system templates (`email_verification`, `email_verification_staff`, `password_reset`), each seeded with a real default the first time it's accessed. A small, safe `{{variable}}` substitution engine (`apps/api/src/lib/email-templates/render.ts`) — no expressions, no code execution, every value HTML-escaped — supplies `user.*`/`verificationUrl`/`resetUrl`/`expiresIn` per send plus `site.*`/`design.*` tokens shared by every template. Design tokens (brand color, backgrounds, text colors, footer text) come from a new `emailBranding` Structured Settings module, editable directly in a template's Advanced HTML for now (no dedicated design-tokens UI yet) — unset, every deployment gets Kenresoft's own dark/indigo default look. The admin editor has a live server-rendered preview, "Restore default," and "Send test email" (always sample data, never a real user's token). A misconfigured/disabled/failing template never blocks a real send — it falls back to the built-in default automatically, logged via `console.error`/`wrangler tail`. Migration `0054_square_nebula.sql` adds `email_templates`; no action needed on an existing deployment (the three rows seed themselves on first access, and the default copy matches what was hardcoded before this change, so existing verification/reset emails look and read the same until an admin customizes them).
- Entries gained a first-class **Featured** flag, independent of any content-type-specific field — a switch in the Entry Editor's Status card, a star badge in the Entries/All Entries lists, `?featured=true` on the admin and public list endpoints (`GET /api/v1/admin/entries`, `GET /api/v1/public/:contentType`), and `cms.entries.list({ contentType, featured: true })` in `@kenresoft-cms/astro` — e.g. for a "featured post" homepage spot, without adding a per-content-type boolean field and remembering its exact name. Migration `0053_minor_red_wolf.sql` adds `entries.featured` (default `false`); every existing entry is unaffected until explicitly marked featured. `@kenresoft-cms/astro`'s `Entry`/`ListEntriesOptions` types gain the field — requires a new package version if you pin an older one.

- `@kenresoft-cms/create --astro` starter now includes working frontend auth: the `/cms` same-origin proxy, browser and server clients, register / login / verify-email / forgot- and reset-password / protected account pages (with two-factor and optional Turnstile), and the `global_fetch_strictly_public` Workers flag. Requires publishing a new `@kenresoft-cms/create` (the starter ships inside it).
- Optional Cloudflare Turnstile check on public website sign-up. Set the `TURNSTILE_SECRET_KEY` Worker secret to require it; unset (the default) nothing changes. `auth.signUp({ turnstileToken })` sends the token (also forwarded by `createCmsProxy`). See `docs/DEPLOYMENT.md`, "Sessions and sign-in from your own frontend", which also documents the recommended proxy, secret, and Workers setup for frontends with accounts.
- `@kenresoft-cms/astro`: a generic `client.auth` API (sign up/in/out, session, email verification, password reset/change, two-factor) over Core's existing better-auth and password-reset routes. `commerce.customerAuth` now delegates to it. `KenresoftApiError` gained an optional `code`; the client gained a `cookies` option for SSR and `commerce.customerAuth.verifyTwoFactor()`. New `createCmsProxy()` same-origin proxy (recommended: makes the session cookie first-party so SSR and third-party-cookie-blocking browsers work on any domain layout). The API gained an opt-in `TRUSTED_PROXY_SECRET` so per-IP rate limits still see real visitors behind a proxy; unset, behavior is identical. Package version 0.5.1 (0.5.0 shipped without `signIn`'s `callbackUrl`, which makes the automatic re-sent verification email land on your site). No database or database changes.

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
