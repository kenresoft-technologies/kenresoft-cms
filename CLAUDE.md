# Kenresoft CMS Monorepo

## CRITICAL: Branch Rules

**NEVER commit directly to `main`.** Main is production — pushes will trigger CI/CD deploy
once a deploy pipeline exists.

- Work on `develop` branch (default working branch)
- Feature work goes on `feature/*` branches off develop
- Merge develop → main via PR (or the user's preferred flow) when ready to deploy
- If you find yourself on main, stop and `git checkout develop` before doing anything

---

## Project Overview

**Kenresoft CMS** is a reusable, Cloudflare-native, API-first content management platform.
First production implementation: a real corporate website. It is not a dashboard for any one
specific customer, and it is also not a multi-tenant hosted service — it's
**single-site-per-deployment** (see `docs/ARCHITECTURE.md` §11): every deployment (its own
Cloudflare account, D1, R2, Worker) backs exactly one website. Additional clients get their own
deployment of the same open-source codebase, not a new tenant inside another customer's.

**Full architecture and technical specification: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**
— this is the source of truth for design decisions, domain model, API contract, security
rules, and the implementation roadmap. Read it before making architectural changes. Any
deviation from it should be recorded in its Changelog section.

**Monorepo layout** (pnpm workspaces):
- `apps/api/` — `@kenresoft-cms/api` (Cloudflare Worker, Hono, D1, R2)
- `apps/admin/` — `@kenresoft-cms/admin` (React + Vite admin SPA)
- `packages/database/` — `@kenresoft-cms/database` (Drizzle schema, migrations, seed data)
- `packages/contracts/` — `@kenresoft-cms/contracts` (shared Zod schemas / API contract)
- `packages/types/` — `@kenresoft-cms/types` (shared TypeScript types)
- `packages/config/` — `@kenresoft-cms/config` (shared ESLint/TS/Prettier config)

---

## Tech Stack (locked — see `docs/ARCHITECTURE.md` §25 for full table)

- **Backend**: Cloudflare Workers + Hono + D1 (Drizzle ORM) + R2
- **Admin**: React + Vite + React Router + TanStack Query + Tailwind + shadcn/ui + Tiptap
- **Auth**: better-auth (D1/Drizzle adapter)
- **Validation/API contract**: Zod + `@hono/zod-openapi`
- **Testing**: Vitest + `@cloudflare/vitest-pool-workers` + Playwright (E2E)

---

## Package Manager

**Always use `pnpm`** — never npm or yarn.

---

## Git Conventions

- Do **not** add a `Co-Authored-By: Claude` (or similar AI attribution) trailer to commit
  messages.
- Prefer small, reviewable commits.
- Every schema change goes through a Drizzle migration — never edit the D1 schema without
  one (see `docs/ARCHITECTURE.md` §16).

---

## Dev Servers

- API: `apps/api` — `wrangler dev`
- Admin: `apps/admin` — `pnpm dev` (Vite)

Ask before running long-lived dev servers if the user has them running elsewhere already.

---

## GitHub

- Org: `kenresoft-technologies`
- Repo: `kenresoft-cms` (public)

---

## Status

Per the roadmap in `docs/ARCHITECTURE.md` §20:

- **Phase 1** (Worker + Hono + D1 + Drizzle + migrations) — done.
- **Phase 2** (content types + fields + entries domain model) — done. Originally shipped with
  a `Project` entity as a multi-tenant boundary above content types; removed in the v0.5
  single-site-per-deployment revision (`docs/ARCHITECTURE.md` §11 Changelog) — content types
  are now the top-level structural resource directly.
- **Phase 3** (admin auth + dashboard + dynamic editor) — done: better-auth backend, login
  flow, authenticated admin CRUD routes, the Content Types → Fields → Entries screens in
  `apps/admin` (sidebar layout, dark mode, breadcrumbs), the dynamic entry editor (a form
  rendered from a content type's field definitions), and role-differentiated authorization —
  the first signup becomes owner, everyone after defaults to editor, and only owners can
  create content types (this gate moved from project creation in the v0.5 revision above).
  The owner-only surface beyond content-type creation now exists too: a Users page
  (`GET /api/v1/admin/users` + owner-gated `PATCH /:id/role`) lists every user with their
  last-active time (derived from the session table, no new column) and lets an owner change
  roles inline — rejected with 400 if it would leave the deployment with zero owners.
- **Phase 4** (draft/publish + scheduled publishing + revisions + restore) — done:
  `EntryRevision` entity snapshotting every entry write (create/update/restore/auto-publish),
  a `GET .../entries/:id/revisions` + `POST .../entries/:id/revisions/:revisionId/restore` API,
  a nullable `publishAt` column on entries with a Cloudflare Cron Trigger (every 5 min) that
  auto-publishes due drafts, and the corresponding `apps/admin` UI: a "Schedule publish"
  datetime field and a revision-history side panel with restore on the entry editor.
- **Phase 5** (R2 media library) — done: a `Media` entity (D1 stores metadata + the R2 object
  key, never the binary), `POST/GET/DELETE /api/v1/admin/media` + `GET .../media/:id/file`,
  and an `apps/admin` Media Library page (upload dialog, thumbnail grid, delete). Uploads are
  restricted to PNG/GIF/JPEG/WebP verified by the file's actual bytes (`src/lib/
  image-metadata.ts`), never the client-supplied Content-Type or filename extension — see
  `docs/ARCHITECTURE.md` §9/§14. Not yet done: WebP dimension parsing (verified but stored as
  null — VP8/VP8L/VP8X each encode dimensions differently).
- **Phase 6** (public/admin REST API + OpenAPI + public API caching) — done.
  `GET /api/v1/public/:contentType` + `GET /api/v1/public/:contentType/:slug`, unauthenticated,
  addressed by content-type/entry slug rather than internal ids. Filters to `status =
  'published'` at the query layer (`getPublishedEntryBySlug`/`listPublishedEntriesFor
  ContentType` in `apps/api/src/repositories/entries.ts`) — a draft matching the requested
  slug 404s exactly like a slug that doesn't exist, never distinguishable from the outside.
  Cloudflare Cache API edge caching on those routes (`Cache-Control: public,
  max-age=300`), invalidated on every entry write and by the scheduled auto-publish sweep
  (`apps/api/src/lib/public-cache.ts`) rather than left to expire blindly. Cache keys are
  built against a fixed internal origin, not the real request host — the scheduled trigger
  has no incoming request to read a host from at all, so a real-host-based key would have
  silently broken invalidation from that path specifically. Every route now migrated to
  `@hono/zod-openapi` (`apps/api/src/lib/openapi.ts`'s `createOpenApiApp()` factory pins a
  shared validation-error shape across every route), backed by request/response Zod schemas
  in the new `packages/contracts` package — the single source of truth shared with
  `apps/admin`, which now imports its types from there instead of hand-duplicating ~160 lines
  of interfaces. A generated OpenAPI document is served at `/api/v1/openapi.json` and a Scalar
  reference UI at `/api/v1/docs` (its own scoped CSP exception in `security-headers.ts`, since
  the strict site-wide default blocks Scalar's assets outright). Two routes — media upload
  (multipart, byte-sniffed) and public form submissions (validated dynamically per-form) —
  don't fit a static request schema and stay outside `.openapi()`'s validation, registered
  for documentation only via `registerPath()`. Not yet done: Workers KV as the caching layer's
  documented (§12) secondary read-through tier — out of scope until cross-colo consistency is
  an actual concern at this deployment's traffic level.
- **Phase 7** (forms + submissions + spam/rate limiting) — done, backend and admin UI both.
  Form/FormField/FormSubmission tables (kept separate from ContentType/Entry — §7 treats
  visitor-submitted data as categorically different from editor-authored content), admin CRUD
  under `/api/v1/admin/forms` (creation owner-gated like content types), and an unauthenticated
  `POST /api/v1/public/forms/:slug/submissions`. The public route: rate limited via the
  Cloudflare Workers Rate Limiting binding (5/60s per client IP — new `[[ratelimits]]` entry in
  `apps/api/wrangler.toml`), validated dynamically per-request against the form's own field
  definitions (`apps/api/src/lib/form-submission-validation.ts`, since every form has different
  fields, unlike content entries which have no server-side field validation at all currently),
  and sanitized by stripping every `<`/`>` character from string values individually rather
  than a `<tag>...</tag>` regex pair (a test caught that the pair-based version left a
  stripped tag's own text content behind, e.g. `<script>alert(1)</script>` → `alert(1)`, not
  empty — removing every angle bracket guarantees no tag can ever be reconstructed from the
  output regardless of how the input was structured). The `apps/admin` UI closing this phase:
  a Forms list + field builder (reuses the same `OptionListEditor` as content-type fields, now
  extracted into a shared component) and a submissions inbox with a status-triage action menu
  backed by a new `PATCH /api/v1/admin/forms/:id/submissions/:submissionId` endpoint — no
  `requireRole` gate, since triaging is an editorial action like entry editing, not a
  structural one.
- **Admin UI polish** (not a roadmap phase — a cross-cutting pass over the `apps/admin` work
  from Phases 3–5) — done: `window.confirm` replaced with shadcn `AlertDialog` everywhere
  destructive, plus `sonner` toast feedback on every mutation across content types, entries,
  media and fields; real data-table behavior (search, column sort, pagination) on the content
  types and entries list pages via TanStack Table; a real Dashboard
  (`GET /api/v1/admin/dashboard`) with content-type/entry/media counts, a draft/published
  donut chart, and a recent-activity list; a Settings page
  (`GET`/`PUT /api/v1/admin/settings`, owner-gated for writes) for the `Settings` singleton
  entity; and real inputs for `select`/`multi_select`/`media`/`reference` fields — both in the
  field builder (an option-list editor, a target-content-type picker) and the entry editor (a
  dropdown, checkboxes, a Media Library picker dialog, and a searchable combobox for
  reference lookups) — closing the plain-text-field gaps noted under Phases 3 and 5 above.
  Also fixed a real bug found while building the dashboard: `entries.createdAt`/`updatedAt`
  used second-precision timestamps, making "recent activity" ordering non-deterministic for
  writes within the same second (now millisecond precision, matching `entry_revisions`). Both
  stretch goals are done too: a cmd+k/ctrl+k command palette (jumps to any page, content type,
  or recently-updated entry) — building it surfaced a real bug in shadcn's generated
  `CommandDialog`, which never renders cmdk's own `<Command>` context provider, so
  `CommandInput`/`List`/`Item` crashed until the palette wrapped its own content in `<Command>`
  explicitly; and drag-to-reorder on the field list via dnd-kit, backed by a new
  `PATCH /api/v1/admin/content-types/:id/fields/reorder` endpoint that requires the given
  field ids to exactly match the content type's existing set before writing anything.
- **Admin UI redesign** (not a roadmap phase — a second cross-cutting pass, prompted by live
  user testing that found the UI "not there yet" next to the backend) — done, 12 small
  commits: a single indigo-blue `--accent-brand` design token feeding `--primary`/`--ring`/
  `--sidebar-primary` everywhere those are already referenced (no per-component reskin
  needed); removed the dialog/sheet/alert-dialog backdrop blur (`bg-black/50`, no
  `backdrop-blur`); raised control heights one step across buttons/inputs/selects/table cells,
  which read as visibly cramped next to body text; fixed dnd-kit rendering its hidden
  accessibility live-region as an invalid direct child of `<table>` (`DndContext` now wraps
  the whole `Table`, not just `TableBody`); fixed `ContentTypesPage`/`EntriesPage` rows only
  being clickable on the exact link text — `DataTable` gained an optional `onRowClick` prop
  guarded against clicks on interactive descendants and post-text-selection clicks, so pages
  opt in via `useNavigate()` while the component itself stays router-agnostic; the Users and
  Forms-admin-UI work described under Phases 3 and 7 above; and a Profile page
  (`apps/admin/src/pages/ProfilePage.tsx`) using better-auth's base client `updateUser`/
  `changePassword` methods directly — zero new backend, and deliberately no phone/bio fields
  since the `user` schema has no such columns to back them.
- **Admin UI/UX polish pass** (not a roadmap phase — a third cross-cutting pass, prompted by a
  product-direction brief asking the admin to read as a mature CMS rather than a basic CRUD
  dashboard, while explicitly preserving the existing architecture and foundation) — done, 13
  commits, every screen verified live in both themes: a `--color-success` token so "published"
  reads as its own color instead of borrowing `--accent-brand` (freeing the brand color for
  actions/links/focus/active states); refined sidebar (taller rows, left accent bar on the
  active item, real icon-rail collapse — `SidebarMenuButton`'s `tooltip` prop existed before
  this pass but was dead code under `collapsible="offcanvas"`, which never reaches the
  collapsed state that renders it) and table primitives (uppercase muted headers — caught a
  real CSS gotcha where sortable columns render through a `<button>`, and browsers' UA
  stylesheet resets `text-transform` on buttons, so the uppercase silently never applied there
  without setting it explicitly); new shared `PageHeader`, `StatusBadge`, and
  `FieldTypeBadge`/`fieldTypeIcon` (content-type and form field builders both draw from
  overlapping `FieldType`/`FormFieldType` unions, so one icon map covers both); `DataTable`
  gained opt-in `enableRowSelection`/`toolbar`/`bulkActions` props, defaulted off so every
  existing caller was unaffected, now used by Entries, Media, and Form Submissions. The Entry
  Editor got a two-column editorial layout (Status/Publishing/Metadata/History/Danger-zone
  sidebar), an unsaved-changes guard (`useBlocker` — requires a data router, which
  `apps/admin/src/routes/router.tsx` already used), and a read-only Preview tab. Entries and
  Media got status/type filters plus bulk actions (looped over the existing single-item
  endpoints via `Promise.allSettled`, not new bulk endpoints). Deliberately did **not** add
  delete actions on content types, content-type fields, forms, form fields, or form
  submissions — confirmed by reading every `apps/api/src/routes/admin/*.ts` route file that
  none of those have a `DELETE` route; delete stayed exactly where it already worked (Entries,
  Media). Zero new npm dependencies — `ui/tabs.tsx` (Settings, the Entry Editor's Preview tab)
  and row selection (TanStack Table's built-in `enableRowSelection`) were already available,
  just unused until now.
- **Settings redesign + unified Submissions + docs catch-up** (not a roadmap phase — a fourth
  cross-cutting pass) — done: Settings replaced its three-tab General/Social/Advanced layout
  with a left-nav, one-section-at-a-time IA covering the full set a serious CMS admin needs
  (General, Appearance, Security, Notifications, Social, Storage, Database, API, Users &
  Permissions, Webhooks, Advanced) — only General/Appearance/Social/API/Users &
  Permissions/Advanced are wired to something real (CORS moved out of Advanced into a new API
  section, which also links to the already-existing-but-unsurfaced Scalar docs/OpenAPI JSON;
  Appearance hosts a real Light/Dark/System control on a new shared `ThemeProvider`, replacing
  the top-bar toggle's old local-only state so both stay in sync); the rest render a
  `ComingSoonSection` describing what they'll cover instead of a fake control. A new unified
  `/submissions` view (mirroring the earlier unified `/entries` view) lists every form
  submission across every form via a new `GET /api/v1/admin/submissions`, joined with each
  submission's form name/slug the same way `listEntriesWithContentType` joins content-type/
  author — `listFormSubmissions` became `listSubmissionsWithForm(db, formId?)` so the existing
  per-form Submissions page picked up the join too. `README.md` was also brought back in line
  with reality (it had still said "Phase 0, no application code yet").
- **Astro integration, Phase 1 (local only)** — done, see `docs/ASTRO.md` for the full guide.
  A new `@kenresoft-cms/astro` workspace package (`integrations/astro/`) — a typed client
  (`createKenresoftClient`) wrapping the public API's `entries.list`/`entries.get`, deliberately
  without a `contentTypes.list()` since no public content-type-metadata endpoint exists to back
  one. `examples/astro-site` (previously a hand-rolled `fetch` wrapper) was rebuilt on top of
  it and brought into the pnpm workspace (`pnpm-workspace.yaml` now lists `integrations/*` and
  `examples/*`) so it can depend on `@kenresoft-cms/astro` via a normal `workspace:*` link instead
  of the `--ignore-workspace` standalone install it briefly needed. Verified end-to-end against
  a real local deployment: created a draft entry via the admin API, confirmed the public API
  404s it exactly like a nonexistent slug, published it, confirmed both the public API and
  `astro dev` serve it immediately, edited it, confirmed a previously-built static `dist/`
  correctly still showed the pre-edit content, then confirmed a rebuild picked up the edit —
  demonstrating the documented "static output needs a rebuild for new content" behavior isn't
  just asserted but actually true. Surfaced a real, not-yet-fixed gap: there's no public,
  unauthenticated route for serving R2-backed media files (only the admin-gated `GET
  /api/v1/admin/media/:id/file` exists), so a `media`-type field can't be rendered by this or
  any public Astro consumer yet. Production deployment (provisioning real Cloudflare resources
  for the CMS, deploying an Astro site alongside it) is explicitly out of scope for this phase
  and not started.
- **Public media serving** (closing the gap noted above) — done: a new unauthenticated `GET
  /api/v1/public/media/:id/file`, mounted before the generic `/api/v1/public/:contentType`
  catch-all (same reason `/public/forms` needed the same treatment), edge-cached for a year via
  the Cache API (media is immutable — no edit endpoint, only create/delete) and invalidated on
  delete. `@kenresoft-cms/astro` gained `media.url({ id })`; `examples/astro-site` now renders a
  featured image when a `media`-type field is present, using the entry's title as `<img alt>`
  since Media's real `altText` still isn't exposed publicly. Verified live end-to-end against
  the running local deployment (upload → public fetch returns byte-identical file with the
  correct `Cache-Control` → delete via admin → public route 404s, confirming the cache
  invalidation actually fires, not just that the code compiles). Two adjacent gaps flagged as
  open product decisions rather than silently resolved either way: a public
  content-type-metadata endpoint, and SSR/webhook revalidation for the Astro example (still
  static, rebuild-to-see-changes) — see `docs/ASTRO.md`'s Known limitations.
- **Astro SSR migration** (closing the "static, rebuild-to-see-changes" gap flagged above) —
  done: `examples/astro-site` switched from static output to server rendering
  (`@astrojs/cloudflare`, pinned to `^12.6.13` since the `14.x` line needs Astro 7 and the
  project is on Astro 5.18.2), so a published edit is visible on the next request with no
  rebuild. `blog/[slug].astro` dropped `getStaticPaths()` in favor of fetching per-request and
  404ing when the slug doesn't resolve.
- **CI/CD pipeline** (`.github/workflows/deploy.yml`, `docs/DEPLOYMENT.md`) — done, and
  deliberately **opt-in per fork**, not wired to Kenresoft's own Cloudflare account: every job
  is gated behind `vars.DEPLOY_ENABLED == 'true'` (a repo variable a fork owner sets
  themselves), uses `environment: production` for protection rules, and reads its Cloudflare
  target from that fork's own `vars`/`secrets` — nothing here assumes or references a
  particular account. `ci.yml` stays build-and-test only. `docs/DEPLOYMENT.md` documents the
  manual `wrangler deploy` path (no CI required) plus a Backups and recovery section (verified
  D1 export/restore, R2 backup flagged as an open gap).
- **Phase 9 (security hardening + backup drill + broader E2E)** — done: rate limiting extended
  from forms-only to `/api/v1/auth/*` (10/60s POST-only, new `AUTH_RATE_LIMITER` binding); a
  real `wrangler d1 export --remote`/restore drill verified against a live deployment, not just
  documented; and the Playwright E2E suite (`apps/admin/e2e/`) substantially extended —
  content-type/field CRUD+rename+publish, form/field CRUD+public submission, add/remove user
  with a full sign-out/sign-in-as-the-new-user round trip through the real login form, global
  variable CRUD, and Examples-template form creation, all run against a dedicated port/D1-state
  harness (`e2e/setup.mjs`) so E2E never collides with a developer's normal `wrangler dev`.
  Surfaced and fixed a real bug along the way: `SameSite=None` cookies need the literal
  `Secure` attribute or browsers silently drop them, regardless of the connection's actual
  scheme — this had been breaking local sign-in generally, not just under E2E.
- **Role model expansion + session monitoring + richer Users page** (not a roadmap phase — a
  fifth cross-cutting pass, prompted by direct user feedback after trying the admin: a report of
  a stuck first-login flow, a request to surface better-auth's session table for monitoring, a
  request for SonicJS's four-role Admin/Editor/Author/Viewer split instead of this app's
  original two, and a screenshot of SonicJS's own Users page as a UI density/maturity
  reference). Roles/sessions/Users-UI items are done; the login-flow report was open at the time
  of this entry (an automated reproduction of the exact reported steps had completed cleanly,
  ruling out the leading same-tab-redirect theory but not identifying a cause) — since resolved,
  see the dedicated entry below. Renamed `owner` → `admin`
  (data-only migration, same privileges) and added **Author** (create entries freely; edit/
  delete only entries they created — `canWriteEntry()` in `apps/api/src/routes/admin/
  entries.ts`; unrestricted reads) and **Viewer** (read-only everywhere via a new global
  `blockViewerMutations` middleware, rather than threading a check through every route) —
  see `docs/ARCHITECTURE.md` §10 for the full model. Content-type/form field management, ungated
  until now, requires admin/editor like every other structural write, with the `apps/admin` UI
  gated to match. Session monitoring: `GET /api/v1/admin/users/:id/sessions` +
  `DELETE .../sessions/:sessionId` (a plain row delete, not better-auth's heavier admin plugin —
  deliberately avoided, per an existing code comment), surfaced as a per-row Sessions dialog on
  the Users page. The Users page itself: stat cards (total/active/administrators/active-this-
  week), role and activity-status filters, a client-side CSV export, and avatar initials — all
  derived from data already in the existing list response, no new aggregate endpoint. Extracted
  `StatCard` out of `DashboardPage` into a shared component now that Users needs the same piece.
- **Owner role and account-security hardening, Phase 1** (not a roadmap phase — a sixth
  cross-cutting pass, prompted by a request that a normal Admin should never be able to lock
  the actual owner of a self-hosted deployment out of their own CMS) — done: a real **Owner**
  role above Admin (`docs/ARCHITECTURE.md` §10 has the full model), with a `ROLE_RANK`/
  `roleAtLeast()` hierarchy (`packages/contracts/schemas/enums.ts`) that replaced ~19 hand-copied
  exact-role-string comparisons across `apps/api`/`apps/admin` — Owner transparently satisfies
  every existing `requireRole('admin')` gate without touching those call sites. New invariants
  in `apps/api/src/lib/user-guards.ts`, applied to every user-management route: the Owner can
  never be demoted/deleted/disabled by anyone else, and no change may leave the deployment with
  zero Owners and zero Admins combined. Account disabling is new (previously delete-only) via a
  `user.disabled` field, enforced in `requireSession` and backed by revoking that user's
  sessions immediately. Disabling an Admin, and transferring ownership
  (`POST /api/v1/admin/security/ownership/transfer`, Owner-only, an atomic role swap), both
  require a fresh password re-check first (`POST /api/v1/admin/security/elevate`, a 5-minute
  per-session elevation — deliberately not better-auth's own ~24h session-freshness concept). A
  new `audit_log` table records role changes, disabling, and ownership transfers through one
  shared `apps/api/src/lib/audit.ts` helper, so "never log a secret" is one rule to hold rather
  than one per call site. `apps/admin`'s Users page marks the Owner with an immutable badge and
  hides destructive actions on that row; Settings → Users & Permissions gained the
  ownership-transfer control. Deliberately **not yet built** (a separate follow-up): password
  recovery via email, recovery codes, and emergency owner-recovery for a fully locked-out
  deployment — this pass is the authorization model itself, which doesn't depend on any of
  those.
- **Developer panel** (not a roadmap phase — an opt-in tooling addition) — done: a "Developer"
  action on Content Types, Entries, Forms, and Media showing that resource's endpoint(s), a
  fields/response reference, and ready-to-copy Astro/TypeScript/JavaScript/React/Next.js/cURL
  snippets for consuming it from an external frontend. Off by default and gated behind a
  discoverable "Developer experience" toggle in Settings → API
  (`Settings.featureFlags.developerMode`, no new schema) plus role (author and above via
  `roleAtLeast`, never viewer — `apps/admin/src/lib/developer-mode.ts`).
- **Account recovery** (closing the gap Owner role/account-security hardening deliberately
  deferred above) — done: password reset via email
  (`POST /api/v1/public/password-reset/{request,confirm}`, a bespoke pair of routes reusing
  better-auth's own `verification` table but hashing the token at rest, since better-auth's own
  reset routes store it in plaintext), a pluggable email layer
  (`apps/api/src/lib/email/{cloudflare,resend,noop}.ts`, selected via `EMAIL_PROVIDER`, `noop`
  by default so `pnpm dev` needs no email setup), owner-generated recovery codes (ten
  single-use, hashed, shown once, elevation-gated to generate/revoke — for "forgot my password
  *and* lost my email"), and two independent owner-recovery mechanisms for a fully locked-out
  deployment: `apps/api/scripts/recover-owner.mjs` (an operator-run CLI shelling out to
  `wrangler d1 execute`, never accepting the new password as a CLI argument) and a break-glass
  `POST /api/v1/system/recover-owner` gated by an `OWNER_RECOVERY_SECRET` Worker secret that's
  absent by default — the route 404s outright, indistinguishable from not existing, until an
  operator deliberately sets it. All of it, plus password-reset confirm and recovery-code
  redemption, shares one conservative rate limiter (`RECOVERY_RATE_LIMITER`, 3/60s per IP).
  Kenresoft itself holds no credential or back door into any deployment through any of this —
  see `docs/ARCHITECTURE.md` §10.1/§11 and `docs/DEPLOYMENT.md`'s setup section.

CI is green on `develop` — was red for three pushes (2026-08-28) from an unhandled-rejection
quirk in better-auth/better-call surfaced by a wrong-password test in the Owner-role pass;
`api: fix a CI-breaking unhandled rejection...` (2026-09-01) fixed it, and a follow-up commit
made ownership transfer a single atomic `db.batch()` (it was two independently-awaited writes
despite its own comments claiming atomicity) and rejected transferring to a disabled account.

**Open-source packaging pass** (2026-09-01, prompted by an external review of the repo ahead of
a wider release) — done: Developer Mode gating replaced its role-floor rule ("everyone at or
above Author automatically gets it") with a real **Developer Tools permission** — owner/admin
still always qualify once the deployment-wide flag is on, but editor/author now need an
explicit per-user grant (`user.developerToolsAccess`, migration `0015_quiet_gamora.sql`;
toggled from a new switch on the Users page, backed by an admin-gated
`PATCH /api/v1/admin/users/:id/developer-tools-access`) rather than every author on a team
seeing developer tooling the moment one admin turns the flag on for anyone. `wrangler.toml`'s
committed `CORS_ORIGINS` dropped a contributor's personal LAN IP (`192.168.0.159`) that had been
checked in for local mobile testing — that kind of override now belongs in the gitignored
`apps/api/.dev.vars` (documented in `.dev.vars.example`), never in the deployed/production
config a fork inherits. The break-glass `OWNER_RECOVERY_SECRET` path gained explicit "this is a
standing master key, not a convenience" warnings in both `wrangler.toml` and
`docs/DEPLOYMENT.md`, plus a recommendation to `wrangler secret delete` it once it's no longer
needed. And a new unauthenticated `GET /api/v1/system/status` (deployment-wide, so it carries
none of the account-enumeration risk the password-reset routes guard against) backs an honest
"email delivery isn't configured" notice on `ForgotPasswordPage` — replacing the generic
"check your email" message when `EMAIL_PROVIDER` is unset — and a matching read-only status
line in Settings → API, so an owner setting up a fresh deployment isn't left assuming
password-reset email works when it silently doesn't.

**Open-items pass** (2026-09-01, working through the backlog of previously-flagged open items
in this file) — done: **WebP dimension parsing** (`apps/api/src/lib/image-metadata.ts`), the
one gap left in Phase 5's media-metadata note above — all three WebP bitstream sub-formats
(VP8/VP8L/VP8X) now parse real width/height instead of storing null, verified with new unit
tests for each format. **R2 media backup/restore** (`apps/api/scripts/backup-media.mjs`,
`pnpm backup-media` / `restore-media`), closing the open gap noted under the CI/CD pipeline
entry above — walks the `media` table's R2 keys and shells out to `wrangler r2 object get`/
`put` per object (the same approach `recover-owner.mjs` uses for D1), verified end-to-end
against real local dev state (backup, then restore the same objects back over themselves,
confirmed byte-identical). **Public media metadata** (`GET /api/v1/public/media/:id` →
`{ altText, contentType, width, height }`, `@kenresoft-cms/astro`'s new `media.get()`) closes the
smaller of the two Astro gaps noted under Public media serving above; `examples/astro-site`
now renders real alt text (falling back to the entry's title only when a file has none set)
and `width`/`height` attributes instead of always faking alt text from the title. The other,
larger Astro gap — a public **content-type-metadata** endpoint — was deliberately left alone
after asking: it's flagged in `docs/ASTRO.md` as a genuine product decision (exposing internal
content-modeling structure publicly), not something to resolve unilaterally. Also fixed along
the way: `docs/ASTRO.md`'s Static vs SSR section and two Known-limitations/Future-work bullets
still described the pre-SSR-migration static-output behavior — a real gap between docs and
`astro.config.mjs` (`output: 'server'` since the Astro SSR migration entry above), now
corrected. The reported stuck first-login flow was believed still open at the time of this entry
(see the correction immediately below — it had, in fact, already been fixed by this point, just
not yet reflected here).

**Correction: the stuck first-login flow was already fixed, and this file just hadn't caught up**
(commit `faaaab5`, 2026-08-28 — predates several entries above that kept describing it as open).
Real root cause: on a cross-site deployment (admin and API on different origins — the same setup
`pnpm dev:live` uses against a live Worker), the session cookie is third-party from the browser's
point of view, and some browsers block third-party cookies by default. The sign-in call still
resolved with no error, since the server-side session write succeeded — only the cookie silently
never landed in the browser, leaving `/login` looking unchanged with nothing to click and no
explanation. Verified against the actual reporting account: a session existed server-side, but
the browser never got redirected. Fixed in `apps/admin/src/pages/LoginPage.tsx` — confirms the
session actually landed (`authClient.getSession()`) right after a successful sign-in/sign-up
before redirecting, and surfaces an explicit error message when it didn't, instead of leaving the
screen looking unchanged with no feedback at all.

**Tiptap rich-text editor** (closing a real gap a follow-up audit found: `docs/ARCHITECTURE.md`
and this file both documented Tiptap as the `rich_text` field's editor, §25's "LOCKED" stack
table included, but it had never actually been wired in — `rich_text` fields rendered as the
same plain `<textarea>` as the generic `textarea` type, and `tiptap` wasn't a dependency
anywhere) — done: a new `apps/admin/src/components/rich-text-editor.tsx` wraps
`@tiptap/react`/`@tiptap/starter-kit`/`@tiptap/extension-link`/`@tiptap/extension-placeholder`
with a small toolbar (bold/italic/strikethrough/H2/H3/bullet+numbered list/blockquote/link/undo/
redo), content still stored and returned as an HTML string — no change to that existing contract,
which `examples/astro-site`'s blog page and other consumers already assumed. `FieldInput` now
routes `rich_text` to it instead of sharing `textarea`'s plain input, and the Entry Editor's
Preview tab renders that HTML for real (`dangerouslySetInnerHTML`, same trust boundary as
`set:html` in the Astro example — reachable only once an authenticated editor/owner has written
it) instead of dumping raw tags as text. The Link mark is constrained to http(s)/mailto both via
its own `protocols` option and a second, explicit check before ever calling `setLink()`, closing
off a `javascript:`-URI vector through this one field. Styled via plain CSS rules scoped to
Tiptap's own `.ProseMirror` class in `index.css` rather than pulling in `@tailwindcss/typography`
for one editor. Verified live end-to-end against an isolated dev instance (dedicated ports/D1
state, mirroring the E2E harness — never the developer's own running `pnpm dev`): signed up,
created a content type with a `rich_text` field, typed and formatted real content through every
toolbar button including a link, confirmed the generated HTML and the Preview tab's rendering
were both correct, with zero console errors.

**Rich-text editor expansion** (immediate follow-up — direct user feedback that the first pass
above was more basic than expected for a "real CMS" editor) — done: images (inserted from the
existing Media Library, reusing the same picker pattern as the `media`-type field), tables
(`@tiptap/extension-table`'s `TableKit`, resizable, with add-row/add-column/delete-table
controls that appear while the cursor is inside one), code blocks with real syntax highlighting
(`@tiptap/extension-code-block-lowlight` + `lowlight`'s common language set, themed via
`.hljs-*` CSS rules mapped to the app's own color tokens rather than an imported highlight.js
theme), text alignment, a highlight mark, interactive task lists, a word/character count
(`@tiptap/extension-character-count`), and a fullscreen toggle. Markdown got two distinct
pieces, deliberately kept separate: typing shortcuts (`# `, `**bold**`, `- `, `` ``` ``, ...)
were already free via StarterKit's own input rules, and a new Write/Preview/Markdown mode
switcher lets someone view or hand-edit the field as Markdown. That Markdown view is a
converted *display* of the same HTML, not a storage-format change — deliberately not wired
through `tiptap-markdown` (which would have made Markdown the editor's real parsing format,
risking every already-saved HTML entry) but through two independent, standalone converters
(`turndown`+`turndown-plugin-gfm` for HTML→Markdown, `marked` for Markdown→HTML) in the new
`apps/admin/src/lib/rich-text-markdown.ts`, so the field's actual storage contract never
changes. Two DOM-shape mismatches needed hand-written fixups to survive that round-trip
correctly: Tiptap's task items nest their checkbox inside a `<label>` next to a separate
content `<div>`, which neither turndown-plugin-gfm's task-list rule nor marked's GFM output
recognizes by default, so both directions get reshaped to and from the flat shape those
libraries expect. Tables and text-alignment don't have a lossless Markdown representation — a
table survives the round trip as an embedded raw-HTML block (valid GFM, and confirmed to parse
back into a real interactive table), while text-alignment is simply not representable in
Markdown and is lost if that path is used, an accepted, inherent limitation of the format itself
rather than a bug. Fixed one real bug found during verification: fullscreen mode initially had
no opaque background and an incomplete flex/height chain, letting the underlying page show
through and cutting content off — needed `bg-popover`, `min-h-0` on the flex chain (flexbox's
default `min-height: auto` otherwise defeats `flex-1`), and a `z-40` (not `z-50`, so Radix
dialogs/popovers opened from inside fullscreen still stack above it). Verified live end-to-end
again the same way as the first pass: task list checkbox state, table row/column edits, code
syntax highlighting, and a full Write → Markdown (edit) → Write round trip all confirmed
correct, zero console errors.

**Deploy tooling: a one-click button, a guided CLI, and updated manual docs** (matching what
Payload/SonicJS/FlareCMS-style projects offer, prompted directly by a user request) — done, with
one important correction made mid-implementation and one honestly-flagged gap. `apps/api/
wrangler.toml` is now split: the top-level `[[d1_databases]]`/`[[r2_buckets]]` deliberately omit
`database_id`/`bucket_name` so a plain `wrangler deploy` — a fresh clone, the new "Deploy to
Cloudflare" button (`README.md`), or the new `pnpm run setup` (`scripts/setup.mjs` +
`scripts/lib/wrangler-cli.mjs`) — triggers wrangler's own automatic resource provisioning
non-interactively; `[env.production]` separately pins Kenresoft's own real, already-live
database/bucket/`BETTER_AUTH_URL`, with `name = "kenresoft-cms-api"` set explicitly (confirmed
against Cloudflare's own current docs: omitting it there deploys to a *different* Worker named
"kenresoft-cms-api-production" instead of the real one). A new `apps/api/wrangler.test.toml`
(concrete placeholder ids) exists solely because `@cloudflare/vitest-pool-workers`' local
Miniflare simulation can't work with the top-level config's now-intentionally-missing ids —
caught by the test suite immediately failing after the split, not by inspection.

The correction: `deploy.yml`'s own top comment already documented it as "opt-in per fork, not
wired to Kenresoft's own account" — initially missed this and pointed the shared `apps/api`
`deploy`/`packages/database` `migrate:remote` scripts at `--env production`, which would have
broken them for every other fork. Reverted those two to stay generic; Kenresoft-specific
deploys use new, separately-named `deploy:production`/`migrate:production` scripts instead.
`recover-owner.mjs`/`backup-media.mjs` got the same correction — `--env` is now an optional
passthrough flag (only Kenresoft needs `--remote --env production`; most forks' real resources
live in the generic top-level config and need no flag at all) rather than hardcoded.
`apps/admin` also gained a deploy path for the first time (a `deploy` script, a new
`deploy-admin` CI job) — Cloudflare Pages, following `examples/astro-site`'s existing pattern.

Honestly flagged, not silently assumed: whether Cloudflare's button setup page actually handles
this monorepo correctly (clone the full repo, then isolate `apps/api` as the Worker root) has
not been proven by a real click-through — documented in `docs/DEPLOYMENT.md` as
experimental/unverified rather than a confident claim, with `pnpm run setup` positioned as the
guaranteed-to-work fallback. Verification for everything else was `--dry-run` only (this session
has real, authenticated write access to Kenresoft's own Cloudflare account, confirmed via
`wrangler whoami` — deliberately never used for an actual deploy or real resource creation): a
`wrangler deploy --dry-run --env production` resolves to the exact real Worker/D1/R2/vars, and a
read-only `wrangler deployments list --env production` confirms it's the same Worker with real,
pre-existing deployment history — not a fresh "-production"-suffixed one. The TOML-editing logic
`scripts/setup.mjs` uses to patch in newly-created ids was verified against a scratch copy of
the real file (correct insertion, `[env.production]` left untouched) but, like the button, has
not been run for real against a live, unprovisioned account.

**Deploy tooling, follow-up: the button actually clicked, and failed as flagged** — the
unverified button risk above turned out real on the first real attempt: Cloudflare reported "No
Wrangler configuration detected," since its button only looks for a config at the repository
root, never inside a subdirectory (confirmed, not guessed, once this happened). Fixed by moving
`wrangler.toml` (and `.dev.vars`/`.dev.vars.example`, which wrangler requires alongside it) from
`apps/api/` to the repo root, with `main = "apps/api/src/index.ts"` and `migrations_dir` updated
to match — every path in the file is relative to its own location, confirmed empirically via
`--dry-run` and a real `wrangler dev` smoke test rather than assumed. Every consumer of the old
path is updated: `apps/api`'s `dev`/`deploy`/`deploy:production` scripts (explicit
`--config ../../wrangler.toml`, though wrangler's own upward directory search would have found
it regardless — confirmed empirically, kept explicit for clarity), `packages/database`'s four
`migrate:*` scripts, `recover-owner.mjs`/`backup-media.mjs`'s `CONFIG_PATH` (the actual
`../wrangler.toml` → `../../../wrangler.toml` distance was gotten wrong once mid-fix and caught
by testing the resolved path against the real filesystem rather than trusting the arithmetic by
eye), `scripts/setup.mjs`'s `WRANGLER_TOML_PATH`, and `apps/admin/playwright.config.ts`'s e2e
`wrangler dev` invocation. `apps/api/wrangler.test.toml` (the vitest-pool-workers-only config)
needed no change — nothing about it was path-sensitive to where the real config lives. A full
button click-through hasn't been re-attempted since this fix; everything else was re-verified
the same way as the original pass (dry-runs against the real account, a real `wrangler dev`,
the e2e migration script, and the full test suite).

**Admin moved off Cloudflare Pages onto its own Worker** (2026-09-02, prompted by a direct
comparison of the installation experience against Payload/SonicJS-style CMSs) — done, after a
docs-verified investigation of three architectures (split hosting as it stood, merging the admin
SPA into the API's own Worker as static assets, and keeping two separate Workers unified only at
the install-script level) and, within the two-Worker option, three URL topologies (two
`*.workers.dev` origins, two Workers behind one custom domain via path-based Routes, and a
merged single origin). Two confirmed facts drove the decision: Cloudflare's own docs now steer
new static hosting toward Workers Static Assets over Pages (a migration banner on Pages' own
docs; Workers Sites already deprecated the same direction), and the "Deploy to Cloudflare" button
is hard-limited to exactly one Worker per click regardless of which architecture is chosen — so
button-driven single-click parity with Payload/SonicJS was never actually on the table without
merging the two apps' runtimes together, which was explicitly ruled out to avoid coupling
`apps/admin`'s deploy/rollback lifecycle to the API's. Landed: `apps/admin/wrangler.toml`, a
static-assets-only Worker config with no bindings and no Worker script at all (`not_found_handling
= "single-page-application"` alone gives React Router's client routes their `index.html`
fallback) — confirmed with a real `wrangler deploy --dry-run` against it. `apps/admin`'s own
`deploy` script now runs plain `wrangler deploy` instead of `wrangler pages deploy dist`;
`scripts/setup.mjs`'s admin deploy step, previously an opt-in prompt defaulting to *no*, is now
unconditional — one `pnpm run setup` run provisions and deploys both Workers, wiring the admin
Worker's real origin into the API's `CORS_ORIGINS` exactly as the old Pages branch did.
`.github/workflows/deploy.yml`'s `deploy-admin` job deploys the Worker the same way, dropping the
now-unneeded `CLOUDFLARE_ADMIN_PAGES_PROJECT` variable. Deliberately **unchanged**: the admin app
talks to the API exactly as before, over its own public HTTPS URL via `VITE_API_URL` + `fetch()`
(`apps/admin/src/lib/api-client.ts`/`auth-client.ts`) — Cloudflare Service Bindings were
investigated and ruled out for this specific link, since they're a server-side Worker-to-Worker
mechanism invisible to browser JavaScript, and the admin app has no server-side code of its own
to hold one; and the API's cross-origin cookie config (`sameSite: 'none', secure: true` in
`apps/api/src/lib/auth-options.ts`) needed no change, since it already handles genuinely
cross-site auth (it predates this pass, added for the "run admin locally against a remote API"
case, and verified by the existing Playwright E2E suite). `docs/DEPLOYMENT.md` gained a "Two
Workers, one install" section explaining the split and documenting custom-domain path-based
Routes as a later, opt-in upgrade to a single origin — deliberately not built into the default
installer, since it needs an already-Cloudflare-managed zone the default `*.workers.dev` flow
doesn't require, and the same-hostname multi-Worker Route pattern, while well-evidenced (official
route-specificity rules plus independent community confirmation), doesn't have one first-party
Cloudflare example to point to. `examples/astro-site`'s own Pages deployment is untouched — out
of scope, a separate reference integration, not part of the CMS's own two Workers.

**C1 verified with a real end-to-end deploy** (2026-09-02) — done: deployed both Workers for
real, to distinctly-named, throwaway resources in Kenresoft's own Cloudflare account
(`*-e2etest` suffixed D1/R2/Workers, never `[env.production]`), then drove the actual deployed
admin URL with a real headless-Chromium Playwright script — sign-up, cross-origin session cookie
(confirmed via `context.cookies()`: `SameSite=None`, `Secure`, scoped to the API's own origin),
refresh persistence, authenticated navigation, sign-out/sign-in, a real content-type creation
(D1 write), and a real media upload (R2 write) — all passing, zero CORS errors, zero failed API
requests. Every resource was deleted afterward and confirmed gone via `wrangler d1 list`/
`wrangler r2 bucket list`. Found and fixed one real, currently-shipping bug this surfaced:
`scripts/setup.mjs`'s `ensureD1()` called `wrangler d1 create --json`, which the wrangler version
this repo actually resolves to (4.126.0) rejects outright ("Unknown argument: json") — breaking
`pnpm run setup` at the very first provisioning step for every fresh install. `--update-config`
looked like the obvious fix (let wrangler own the TOML edit instead of this script's own regex
surgery) but, confirmed empirically against a real database twice (once with a mismatched
`--binding`, once with it corrected to match), it silently no-ops against a `wrangler.toml` even
when everything lines up — consistent with the wrangler skill's own "newer features are
JSON-only" guidance. Fixed by parsing `database_id = "..."` out of the
command's plain-text output instead, verified against real `wrangler d1 create` output before
and after the fix. The GitHub Actions path was deliberately *not* triggered for real — that
would mean setting real Cloudflare secrets and `DEPLOY_ENABLED=true` on the actual repo, a
settings change requiring its own explicit sign-off — verified instead by confirming its exact
underlying commands are the same ones just proven to work manually.

**Real production reset + a real onboarding bug found and fixed** (2026-09-02) — done: at the
user's request, deleted Kenresoft's actual live Worker/D1/R2 for real (backed up first via
`wrangler d1 export`/`backup-media.mjs`, though the deployment held no real data — it was always
a test), removed `wrangler.toml`'s now-stale `[env.production]` block to match a genuine fresh
fork's shape, then redeployed from scratch via `pnpm run setup` to evaluate the onboarding
experience as a real first-time developer would see it. That redeploy surfaced a real bug: the
freshly-deployed API Worker threw better-auth's `"you are using the default secret"` error on
every request (confirmed via `wrangler tail`), even though `wrangler secret list` showed
`BETTER_AUTH_SECRET` as configured. Root cause, per the version history
(`wrangler versions list`): `ensureAuthSecret()` runs before the Worker's first-ever code
deploy, when `wrangler secret put` creates a bare placeholder Worker just to hold the secret —
and the real application code deployed afterward didn't correctly carry that secret forward. A
plain, standalone `wrangler secret put` issued *after* every deploy had already finished fixed
the live site immediately, with no redeploy needed — confirming where the gap was. Fixed by
adding `reassertAuthSecret()`, re-applying the same already-generated secret one more time as the
truly last step in `scripts/setup.mjs`, after the final CORS-wiring redeploy. Attempts to
deterministically reproduce the original failure against throwaway D1/R2/Worker resources (a
clean single secret-set-then-deploy, and a set-then-three-deploys sequence matching the script's
real shape) both came back healthy immediately — meaning this is most likely a Cloudflare-side
propagation edge case rather than a fully deterministic ordering bug, plausibly triggered by the
unusually rapid run of repeated secret-set calls this session's own testing produced (see below)
rather than something a normal single clean run would hit — but the fix is unconditionally safe
and costs one extra `wrangler secret put` call regardless, so it stays in as defensive insurance.
Separately, verifying `pnpm run setup` non-interactively (piping answers via
`printf ... | pnpm run setup`) hit a genuine Node `readline/promises` quirk, confirmed in
isolation with a two-question test script: once a piped, non-TTY input stream reaches EOF, a
*second* sequential `rl.question()` call never resolves, even if its answer was already fully
buffered before EOF — Node silently exits on an empty event loop rather than erroring. Worked
around for testing purposes only (keeping the child's stdin pipe open between writes instead of
closing it in one shot) — this doesn't affect a real interactive terminal user at all, since a
real TTY never sends EOF from normal typing.

**Correction to the above: the real root cause of the "default secret" bug was found, and it
was not deploy ordering or Cloudflare-side propagation** (2026-09-02, same day, a later pass) —
a fresh `pnpm run setup` run against a genuinely clean account hit the exact same
`"you are using the default secret"` error again, *after* `reassertAuthSecret()` had already run
as the documented last step — proving that fix never actually worked and the ordering theory
above was wrong. The real cause: `scripts/lib/wrangler-cli.mjs`'s `runWrangler()` hard-codes
`stdio: ['ignore', 'pipe', 'inherit']`, and every caller that also passes `execFileSync`'s
`input` option (setting `BETTER_AUTH_SECRET`/`RESEND_API_KEY` — anywhere a value needs to reach
wrangler over stdin) silently has that value replaced with an **empty string**. Confirmed in
total isolation with a throwaway script piping a known string through `execFileSync` with this
exact `stdio`/`input` combination: `'ignore'` at `stdio[0]` wins over `input` in this Node
version, contrary to how Node's own docs read — wrangler still reports success and
`secret list` still shows the secret as "configured" (it has a name, just an empty value), and
better-auth correctly treats an empty string as falsy and falls back to its own insecure
default. This explains why the original diagnosis looked plausible: every fix attempt that
"worked" (the original live-site fix, and every throwaway-resource repro attempt) was a
`wrangler secret put` piped by hand directly in a real shell — a completely different code path
that was never affected by this bug at all — while every attempt that went through
`scripts/setup.mjs`'s own `runWrangler()` kept failing. Fixed at the actual source: `stdio[0]`
changed to `'pipe'`, which behaves identically to `'ignore'` for the calls that never pass
`input` and finally lets `input` reach wrangler for the ones that do. `reassertAuthSecret()` was
removed — with the real bug fixed, it's dead weight, and verified as such: a from-scratch
throwaway D1/R2/Worker, secret set exactly once via the fixed `runWrangler()`, deployed once,
`get-session` returned `200` on the very first try. The real, live `kenresoft-cms-api`/
`kenresoft-cms-admin` deployment was broken by this same bug (from the *previous* pass's
`reassertAuthSecret()` call, which used the same broken code path) and is now fixed the same
way, then re-verified end to end: sign-up, session-cookie persistence across a refresh, an
authenticated API request, a real content-type CRUD operation, a real media upload, sign-out,
sign-in — 16/16 checks against the real deployed URLs, zero CSP violations, zero console errors,
zero failed API requests.

**Component READMEs, CORS idempotency, and Admin Worker security headers** (2026-09-02) — done.
`apps/api/README.md` and `apps/admin/README.md` are new (the root `README.md` was rewritten
around them, `pnpm run setup` promoted to the clearly-primary path, an "Advanced: Individual
Components" section linking out); `integrations/astro/README.md` was expanded in place. Verified,
not assumed, which of the two apps a standalone "Deploy to Cloudflare" button can actually cover:
the API's button (full-repo URL, already real-click-through-verified) keeps working; a
subdirectory-scoped button for `apps/admin` was confirmed impossible by actually reproducing what
Cloudflare's own docs say a subdirectory URL does (isolate that directory as the *entire* new
repo) — copying `apps/admin` alone into a scratch directory and running `pnpm install` fails
immediately, `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`, since it has a real (not type-only) runtime
dependency on the sibling `@kenresoft-cms/contracts` workspace package. `apps/admin/README.md`
documents this plainly instead of claiming a button that doesn't work; fixing it for real would
mean publishing `@kenresoft-cms/contracts` to npm or vendoring it, neither attempted (out of scope).
`scripts/setup.mjs`'s CORS-origin wiring is now idempotent (`addCorsOrigin()`, verified with a
scratch-file test: three consecutive calls with the same origin add it exactly once and report
`false`/no-op on the second and third) — previously it unconditionally appended on every run.
The Admin Worker (assets-only, no application code) now generates `dist/_headers`
(`apps/admin/scripts/generate-headers.mjs`, wired into its `build` script) with a
Content-Security-Policy and the same security-header set as the API middleware, scoped correctly
since Workers Static Assets don't inherit Worker-generated headers at all. The CSP itself was
tuned empirically, not guessed: served as `Content-Security-Policy-Report-Only` against a real
local build, driven through sign-up, the user-menu dropdown, the command palette, a content-type
dialog, and the media-upload dialog — found and fixed one real gap (Radix UI/cmdk apply computed
inline `style` attributes at runtime, needing `'unsafe-inline'` for `style-src` specifically,
nothing else), then re-verified in enforce mode with zero violations, then confirmed live via
`curl -I` against a real (throwaway) deployment that every header actually reaches the browser.
Full validation pass: typecheck and lint clean across the workspace (lint surfaced one real gap
of its own — `apps/admin`'s ESLint config had no Node globals for `scripts/`/`e2e/`, fixed with a
scoped override plus adding `globals` as a direct devDependency); all 26 `apps/api` test files
and all 23 `apps/admin` test files pass (individually/in small batches for the API suite — the
full single-process run hit the same pre-existing Windows/workerd local-module-fallback
resource-exhaustion flakiness documented earlier in this file, not a code issue, confirmed by the
same files passing cleanly once resource pressure eased).

**CI fix: the generic build job needs a placeholder `VITE_API_URL`** (2026-09-02) —
`apps/admin/scripts/generate-headers.mjs` (from the entry above) correctly throws when
`VITE_API_URL` is unset, since a real deploy genuinely needs it — but `.github/workflows/ci.yml`'s
`pnpm build` step only validates that the monorepo compiles and was never pointed at any
deployment target, so it broke CI on the very next push. Fixed by giving that one job a
placeholder `VITE_API_URL`, leaving `deploy.yml`'s real deploy path (already sourcing a real
`vars.VITE_API_URL`) untouched. Verified by watching the actual GitHub Actions run go green
(`gh run watch`), not just a local repro.

**Admin-only deploy button: the real fix, not just the documented limitation** (2026-09-02/03) —
the entry above's `apps/admin/README.md` correctly documented that a subdirectory-scoped "Deploy
to Cloudflare" button couldn't work, since `apps/admin` had two `workspace:*` dependencies a
subdirectory-isolated clone can't resolve at all (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`):
`@kenresoft-cms/contracts` (real runtime code — `ROLE_RANK`/`roleAtLeast`) and
`@kenresoft-cms/config` (dev-only ESLint rules), plus a `tsconfig.json` `extends` reaching outside
the directory entirely. Fixed all three: `@kenresoft-cms/config`'s rules and the root
`tsconfig.json`'s compiler options are now inlined directly into `apps/admin` (own copies,
`eslint.config.js`/`tsconfig{,.node}.json` — no automatic sync if the shared config changes,
flagged in a comment); `@kenresoft-cms/contracts` is now a real, publicly published npm package
(source unchanged, still lives at `packages/contracts`), depended on by a real semver range
instead of `workspace:*`, with a new root `.npmrc` (`link-workspace-packages=true`) keeping local
monorepo dev symlinked to the workspace copy exactly as before — only a standalone clone outside
the monorepo actually reaches the registry. Along the way, prompted by a direct user question
about branding, every workspace package was renamed from the `@kenresoft/*` scope to
`@kenresoft-cms/*` (a mechanical rename across all 6 packages and every consumer, verified by a
clean typecheck and the full test suite afterward) before publishing, since `@kenresoft` is the
company's general scope and `@kenresoft-cms` is specific to this product.
`packages/contracts/package.json` uses `publishConfig` to point external consumers at a compiled
`dist/` (new `tsconfig.build.json`) while keeping the base `main`/`types`/`exports` pointed at raw
`.ts` source for fast local monorepo dev with no separate build step — verified via `pnpm pack`
(not plain `npm pack`, confirmed to NOT apply `publishConfig` overrides or rewrite `workspace:*` —
a real gotcha caught by inspecting the packed tarball's `package.json`, not assumed).

Published for real to the npm registry, under a `kenresoft-cms` npm Organization the user created
for this (npm requires an Organization matching the scope; publishing also required a per-publish
browser 2FA approval an ordinary access token can't bypass). One real mistake happened here and
was caught, not silently avoided: the first publish (`0.1.0`) shipped with a stale `README.md`
still naming the old `@kenresoft/contracts` scope — root-caused to the rename script using
`git grep -l`, which only touches **tracked** files, silently skipping `README.md`/`.npmrc`/
`tsconfig.build.json` that had been created earlier in the same session and were still untracked
at rename time. Fixed by patching the two affected files and publishing `0.1.1` immediately
(the live registry content re-verified via `npm view ... readme` afterward, not assumed fixed).
The full install/build/deploy chain was re-verified twice against completely isolated standalone
copies of `apps/admin` — once via a local tarball (before the real publish, to de-risk it), once
against the real published registry package after — `pnpm install && pnpm build && wrangler
deploy --dry-run` all succeeding with zero errors both times. Not yet done: an actual live
click-through of Cloudflare's "Deploy to Cloudflare" button UI for a subdirectory URL pointing at
`apps/admin` specifically — the dependency-resolution blocker that made this categorically
impossible is fixed and verified as above, but the button's own wizard flow hasn't been exercised
for real. `apps/admin/README.md` now carries a draft button URL for this
(`.../tree/develop/apps/admin`, going by the subdirectory format Cloudflare's own
`create-cloudflare` tool documents) explicitly marked unverified, rather than either omitting it or
claiming it works — Cloudflare's own deploy-button docs don't spell out the subdirectory query
format for this specific button service.

**A real `npm create` scaffolding tool, and the three remaining loose ends from the pass above**
(2026-09-03) — done. `packages/contracts/package.json` gained `repository`/`bugs`/`homepage`
fields and published as `0.1.2` (the npm page was missing them). New package
`@kenresoft-cms/create` (`packages/create`, published to npm) backs `npm create
@kenresoft-cms@latest my-cms` — now the root README's primary "Recommended" install command,
`git clone` demoted to a parenthetical equivalent. Its one file, `bin/create-kenresoft-cms.mjs`,
downloads a GitHub tarball, extracts it stripped of the top-level `<repo>-<ref>/` wrapper, removes
any `.git` defensively, and runs a fresh `git init` — deliberately fetching the template fresh on
every invocation rather than bundling a snapshot in the published package, so future CMS changes
reach users immediately with no need to ever republish this tool (only a change to the download
script's own mechanics would). A real bug was caught before publishing, not after: the script
initially hardcoded `BRANCH = 'main'`, discovered wrong by checking `git log` on `origin/main` vs
`origin/develop` — `main` was nearly empty (this repo's actual default branch, confirmed via
`gh repo view --json defaultBranchRef`, is `develop`; `main` is reserved for an eventual release
promotion per this file's own branch rules). Fixed by using GitHub's special `HEAD` ref instead of
any hardcoded branch name — confirmed empirically (not assumed) that `codeload.github.com`'s
`HEAD` ref resolves to whatever the repository's actual default branch is, by checking for a file
only present on `develop`. Verified end-to-end for real: ran the script against a scratch
directory, confirmed the extracted content matched `develop` (not stale `main`), confirmed a fresh
un-committed git repo was created, then cleaned up. The existing "Deploy to Cloudflare" buttons
(API Worker's and the new Admin Worker draft) were separately checked and confirmed to already use
no explicit branch/ref in their URLs, so they already correctly follow the default branch too — no
separate fix needed there. The npm token pasted in plain chat during the earlier publish attempt
never completed a publish (blocked by npm's OTP-for-publish requirement) but remains a loose end
only the account owner can close — flagged to revoke it, not something this session can do.

**The two loose ends closed for real** (2026-09-03) — the user published both packages
(`@kenresoft-cms/contracts@0.1.2`, `@kenresoft-cms/create@0.1.0`) and revoked the leaked npm
token. `npm create @kenresoft-cms@latest` was then verified for real against the live registry
(not just by running the script file directly): it correctly resolves, downloads, and scaffolds a
real project. The Admin Worker's draft deploy-button URL was also real-click-tested by the user —
the `tree/<branch>/<path>` subdirectory format is now **confirmed working**: Cloudflare's wizard
correctly scoped itself to `apps/admin`, evidenced by its own pre-filled `kenresoft-cms-admin`
project name (from this directory's `wrangler.toml`, not the API's) and `npm run build`/`npm run
deploy` commands (from this directory's own `package.json`, not a repo-root one), and it correctly
prompted for `VITE_API_URL`. The flow was deliberately backed out of before actually clicking
Cloudflare's own "Deploy" — that step creates a real GitHub repo and a real Worker, not warranted
for a config-detection check with a placeholder API URL. `apps/admin/README.md` updated to reflect
this precisely: config-detection confirmed by a real click-through, full completion-to-a-live-
Worker still open for whoever next has a real API URL to complete it with.

**Admin bundle code-splitting** (2026-09-03, prompted directly by the recurring "chunks larger
than 500kB" build warning) — done: `apps/admin/src/routes/router.tsx`'s every route (except the
top-level `AppLayout` shell) now uses React Router's own `route.lazy` data-router API instead of a
static `element` import, so each page is its own chunk downloaded only when actually visited,
rather than one shared bundle. The old single `index-*.js` was 1.9MB — dominated by two
page-specific dependency trees every session paid for regardless of which page they ever opened:
Tiptap's full extension set (`EntryEditorPage` only — confirmed via `grep` that
`field-input.tsx`, the only consumer of the rich-text editor, is itself only ever imported by that
one page) and Recharts (`DashboardPage` only). After the split: the shared shell chunk is 351kB,
most pages are a few kB each, and only `EntryEditorPage` (726kB — Tiptap's own inherent weight:
starter kit, tables, code blocks with `lowlight` syntax highlighting, the Markdown round-trip
converters) still exceeds Vite's 500kB warning threshold. Deliberately left at that size rather
than chased further (e.g. also async-loading the Markdown-mode converters only when that view is
opened) — it's a single opt-in, feature-rich editor route, not something loaded on every page load
the way the old bundle was, and splitting further would trade a modest additional size win for
real complexity (async-loading library code mid-edit) and UX risk (visible pop-in while typing).
Verified two ways, not just by reading the build output: a real Playwright browser load of the
built `dist/` (via `vite preview`) confirmed the `/login` route pulls in exactly its own small
lazy chunk plus the shared shell — not the old monolith — with the page rendering correctly and
no console errors beyond the expected placeholder-API-URL network failure; and the full
typecheck/lint/test suite (23 files, 129 tests) re-run clean afterward.

**Upgrade story for existing installs, plus a CMS-completeness gap pass** (2026-09-03, prompted
directly by the user asking how someone running an older version actually updates) — done. Found
a real, live bug while answering that question, not just designing the update path in the
abstract: `scripts/setup.mjs`'s `ensureAuthSecret()` unconditionally regenerated and overwrote
`BETTER_AUTH_SECRET` on every run, silently invalidating every current user's session — meaning
the obvious "just run `pnpm run setup` again to update" instinct would have quietly logged
everyone out. Fixed to check first (`wrangler secret list --format json`, confirmed empirically
to return real parseable JSON) and only prompt to rotate if already set, defaulting no — a second
real gotcha surfaced while building this: `runWrangler()`'s default `stdio` inherits stderr
straight to the terminal rather than capturing it, so the initial version of this check (matching
error *messages*) could never have actually detected the "Worker not found" case for a genuinely
first-ever install; confirmed via direct reproduction that `error.stderr` was `null` under the
default stdio before fixing it with a per-call `stdio: ['pipe','pipe','pipe']` override. New
`pnpm run update` (`scripts/update.mjs`) is the actual answer to the update question: installs
deps, applies any new migrations, redeploys both Workers — and deliberately nothing else (no
secrets, no D1/R2 provisioning, no CORS writes, no email re-prompt). `deployApi()`/
`buildAndDeployAdmin()` were extracted out of `setup.mjs` into a new shared
`scripts/lib/deploy-helpers.mjs` so both scripts share one implementation instead of two copies
drifting apart. `packages/create/bin/create-kenresoft-cms.mjs` now also adds an `upstream` git
remote and an initial commit after scaffolding — without a remote, a scaffolded install had no
way to receive future updates at all short of re-scaffolding from scratch; the initial commit
gives a later `git fetch upstream && git merge upstream/<branch>` real history to merge against
rather than an empty unborn branch. New `docs/DEPLOYMENT.md` "Updating an existing install"
section ties this together (get the code however your install was created, then `pnpm run
update`, never `setup` again). All three pieces verified for real, not just read back: a live,
piped-input run of `pnpm run setup` against real throwaway D1/R2/Workers confirmed the new
rotate-or-skip prompt appears and correctly leaves the secret untouched when declined; `pnpm run
update` against that same real deployment then completed with zero prompts, correctly reported
"no migrations to apply," and redeployed both Workers cleanly; every real resource was deleted
and `wrangler.toml` reverted afterward, matching this project's standing practice.

Also researched (web search, not assumed) what a self-hosted CMS this project's size is generally
expected to have, cross-referenced against what already exists here, to find genuine gaps rather
than re-suggest already-built things:
- **Fixed as a direct, bounded gap**: the public content/media API (list-by-content-type,
  get-by-slug, media file/metadata) had no rate limiting at all, unlike forms/auth/recovery — a
  flood of requests for varying or nonexistent slugs never hits the edge cache
  (`public-cache.ts`) and reaches D1 every time. New `PUBLIC_CONTENT_RATE_LIMITER` (300/60s per
  IP — deliberately loose; this guards against abuse/cost, not a security boundary, and real
  read traffic legitimately bursts far above what a login attempt should) applied broadly across
  `/api/v1/public/*` in `apps/api/src/index.ts`, layered under the tighter route-specific
  limiters that already existed. New `apps/api/wrangler.test.toml` binding entry and a new test
  file (`public-content-rate-limit.test.ts`) mirroring the existing `auth-rate-limit.test.ts`
  pattern.
- **Documented, not code** (confirmed via research, not assumed): Cloudflare D1's
  [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is a free,
  always-on, zero-setup 30-day point-in-time-recovery feature — meaning D1 already had a strong
  automatic safety net this project had never told anyone about. R2 was separately confirmed to
  have **no** equivalent built-in versioning (still an open Cloudflare feature request, not
  shipped), which is exactly why `backup-media.mjs` matters more for media than the D1 export
  path does for content. Both now explained together at the top of `docs/DEPLOYMENT.md`'s
  "Backups and recovery" section.
- **New `CHANGELOG.md`**: starts now rather than reconstructing 183 prior commits — this file
  (`CLAUDE.md`) is the detailed historical/agent-context record; `CHANGELOG.md` is the short,
  user-facing "what changed" list for someone deciding whether to `pnpm run update`.
- **Flagged as real gaps, deliberately not built without a decision** (matching this project's
  own standing rule against speculative feature work — see the Workers KV precedent above): admin
  **two-factor authentication** (genuinely low-effort to add specifically here — `better-auth`,
  already a dependency, ships an official `two-factor` plugin, confirmed present in
  `node_modules`, so this would mostly be wiring plus admin UI, not a new auth system);
  **webhooks** on publish/update (common in comparable headless CMSs, but the original driving
  use case — triggering a static rebuild — is now moot for `examples/astro-site` since the SSR
  migration, so the remaining use cases are speculative until someone has one); **content-level
  export/import** (bulk entry portability, independent of the full-database D1 export); and
  **multi-language/locale content variants** (a large feature genuinely absent, common in
  Strapi/Payload/Directus). Deliberately not implemented: none of these have a concrete driving
  need yet, and building them speculatively would repeat the exact mistake the Workers KV
  decision above was written to avoid.

**Two-factor authentication** (2026-09-03, the first of the flagged gaps above actually picked
up, on direct user instruction to keep closing them) — done, and real end-to-end for once
rather than trusted from docs alone. `better-auth`'s official `two-factor` plugin
(`apps/api/src/lib/auth-options.ts`, TOTP + backup codes only — no email/SMS OTP, since that
needs its own send-email wiring nobody asked for) needed a real schema addition:
`user.two_factor_enabled` plus a new `two_factor` table (secret, backup codes), migration
`0016_green_franklin_richards.sql`, generated via `drizzle-kit generate` rather than
hand-written, shape dictated entirely by the plugin's own schema — confirmed against the
installed package's actual `.d.mts` files and schema object rather than assumed from memory of
the library's API. Enrollment lives on `apps/admin`'s Profile → Security tab (new
`two-factor-settings.tsx`: password → QR code + backup codes → verify-and-enable, matching
better-auth's own default `skipVerificationOnEnable: false` two-step flow, confirmed via their
docs rather than guessed), not a deployment-wide Settings toggle — 2FA is inherently per-account.
`LoginPage.tsx` now handles the post-password 2FA challenge: checking `data.twoFactorRedirect`
directly off `signIn.email()`'s own resolved value (simpler than the plugin's alternative
`onTwoFactorRedirect` client-callback config, which would have needed bridging a callback
registered outside React into component state) and switching to a code-entry step with a
backup-code fallback. The new `PUBLIC_CONTENT_RATE_LIMITER` pass's own `AUTH_RATE_LIMITER`
(pre-existing, POST-only, 10/60s) automatically covers every new two-factor endpoint too, since
it's applied broadly to `/api/v1/auth/*` — confirmed as a side effect of verification, not a
separate change. Verified for real: wrote an RFC 6238 TOTP generator from scratch in a throwaway
Node script (base32 decode + HMAC-SHA1 + dynamic truncation) and drove the actual API of a real,
isolated local `wrangler dev` instance (dedicated D1 persist-to path, per this project's standing
rule to never touch a developer's own local dev database) through sign-up → enable → verify →
enforced-2FA sign-in → backup-code sign-in → backup-code regeneration (old code confirmed
rejected) → disable → confirmed plain sign-in works again — 25 real assertions, all passing
(split across two script runs after the first one legitimately tripped `AUTH_RATE_LIMITER` from
firing too many auth calls back-to-back, which is itself further confirmation that limiter
works correctly against these new routes too). New tests: `LoginPage.test.tsx` (TOTP and
backup-code login paths) and `ProfilePage.test.tsx` (enable/disable flows, mocking `qrcode`'s
`toDataURL` since jsdom has no canvas).

**Webhooks** (2026-09-03, the second flagged gap picked up on direct user instruction to keep
going) — done, and both delivery and its failure path verified against real network activity,
not just unit-tested. New `webhooks`/`webhook_deliveries` tables (migration
`0017_lovely_shriek.sql`) — one webhook can subscribe to any subset of `entry.created`/
`entry.updated`/`entry.published`/`entry.unpublished`/`entry.deleted`, optionally scoped to one
content type (null = every content type), with a server-generated signing secret (`crypto.
getRandomValues`, never client-supplied — same reasoning as `BETTER_AUTH_SECRET`) never returned
by any route except the moment it's created or explicitly regenerated. Every route
(`apps/api/src/routes/admin/webhooks.ts`) is admin-and-above only, stricter than content-types/
forms which admit editor for field-level edits — a webhook's secret and its ability to make this
deployment POST arbitrary JSON to any URL an admin chooses put it closer to a security-relevant
capability than day-to-day editorial work. Dispatch (`apps/api/src/lib/webhooks.ts`) is wired
into every entry write path (`routes/admin/entries.ts`'s create/update/delete/restore, plus the
existing scheduled auto-publish sweep in `index.ts`) via `ctx.waitUntil()`, so a slow or dead
subscriber endpoint never holds up the response an editor is waiting on; each delivered payload
is deliberately just the entry's identity/status, not its full `data`, keeping every delivery
small and bounded regardless of entry size. Failed deliveries retry automatically (fixed 5
attempts) on the same 5-minute Cron Trigger scheduled publishing already uses, rather than
introducing a second trigger or a queue for this. A real gotcha surfaced and fixed along the
way: `dispatchWebhookEvent`/`retryFailedWebhookDeliveries` initially typed their execution-context
parameter as the global `ExecutionContext` — failed to typecheck against Hono's own
`c.executionCtx`, traced to two different `@cloudflare/workers-types` versions coexisting in this
monorepo's dependency tree (already visible in `pnpm install`'s own peer-dependency warnings);
fixed by typing the parameter as `Pick<ExecutionContext, 'waitUntil'>`, the only method actually
used, sidestepping the version mismatch entirely rather than chasing which package needed
pinning. Verified for real, twice: `apps/api/test/webhooks-routes.test.ts`'s dispatch tests point
a subscribed webhook at a `.invalid` domain (IANA-reserved to never resolve) and assert the
failure gets recorded correctly — confirmed the more obvious choice, an unreachable `localhost`
port, actually crashes this project's Windows workerd test sandbox with an uncatchable low-level
`ConnectEx` error distinct from a normal fetch rejection, so the DNS-failure path was used
instead once that was found; and, separately, a genuine live delivery was driven end-to-end
against a real local `wrangler dev` instance and a real Node HTTP receiver — signed payloads
correctly received, the `X-Kenresoft-Signature` header independently re-derived and confirmed to
match (and confirmed to reject when computed with the wrong secret, proving the check actually
discriminates), and the API's own delivery log confirmed to show both as successful with the
receiver's real 200 status. New Settings → Webhooks UI (`apps/admin/src/pages/settings/
WebhooksSection.tsx`) replaces that section's `ComingSoonSection` placeholder — list, create/edit
dialogs, a delivery-log viewer, secret reveal-once-on-create-or-regenerate, and an inline
enabled/disabled toggle per row.

**Content-level export/import** (2026-09-03, the third of the four originally-flagged gaps) —
done: `GET /api/v1/admin/entries/export?contentTypeId=` and
`POST /api/v1/admin/entries/import?contentTypeId=` (`apps/api/src/routes/admin/entries.ts`,
registered before `/{id}` for the same static-path-precedence reason as the field-reorder route
in `routes/admin/content-types.ts`). Deliberately scoped to one content type at a time, not a
whole-database dump — that's already covered by D1's own export/Time Travel
(`docs/DEPLOYMENT.md`'s Backups section) and was explicitly called out as the gap this feature
fills. The exported shape (`packages/contracts/schemas/entries.ts`'s `contentTypeExportSchema`)
carries the content type's name/slug alongside each entry's slug/status/data/publishAt but
deliberately no ids or timestamps — ids aren't portable across deployments, and import identifies
"already exists" by slug (`getEntryBySlug`, already existed for the public API) rather than id, so
a file can be re-imported into the same content type on a different deployment entirely, not just
re-uploaded into itself. Import upserts per entry (create if the slug is new, update if it
already exists) via the existing `createEntry`/`updateEntry` repository functions — meaning each
imported entry is itself snapshotted as a revision and dispatches the same `entry.created`/
`entry.updated` webhook events and public-cache invalidation a normal write would, not a bypass
path. A file's embedded content-type identity is checked against the target content type's slug
and the import 400s on a mismatch, catching the "imported the wrong file into the wrong content
type" mistake rather than silently scrambling data. Gated `requireRole('admin', 'editor')`
(stricter than every other entry route, which has no role gate beyond the global viewer block) —
a bulk import writes entries regardless of who created them, bypassing the per-entry
author-ownership check (`canWriteEntry`) every single-entry write route enforces, so it needed the
same floor as structural content-type/field changes rather than being left open to every
non-viewer role. `apps/admin`'s Entries page gained Export (downloads a `.json` file via a
`Blob`/`URL.createObjectURL` — no new backend needed for the download itself) and Import (a
hidden file input plus a toast summarizing created/updated/failed counts, with per-slug error
detail on failure) buttons. Verified with `apps/api/test/entries-export-import.test.ts` (5 tests,
real D1): round-trip export shape, create-vs-update-by-slug behavior in one import call, the
content-type-mismatch 400, and the editor-vs-author role gate (author demoted via the existing
`PATCH /users/:id/role` route, since a fresh signup after the first always defaults to editor).

**Three gaps from an external review, closed** (2026-09-03, prompted by a third-party read-through
of the repo ahead of a wider release) — done. (1) `scripts/setup.mjs`'s `ensureD1()`/`ensureR2()`
previously treated "a `database_id`/`bucket_name` is already present in `wrangler.toml`" as proof
the resource still exists on Cloudflare, when it only proves the config remembers having created
one — a database or bucket deleted out-of-band (dashboard, another script, account cleanup) would
be silently skipped here and only fail much later, deeper into setup, with a confusing error far
from the actual cause. Fixed with a real existence check (`wrangler d1 info`/`r2 bucket info
--json`) before skipping, confirmed empirically against the real Cloudflare account (not
guessed): a missing D1 database fails `d1 info` with "Couldn't find a D1 DB...", a missing R2
bucket fails `r2 bucket info` with "The specified bucket does not exist" — different enough
wording that each call site checks its own pattern. A genuinely-missing resource is now recreated
(D1's `database_id` line gets overwritten in place rather than a second one inserted; R2's
`bucket_name` is already the same hardcoded value so needs no rewrite at all), while any other
failure (auth, network, rate limit) still re-throws instead of being misread as "safe to
recreate." (2) `docs/DEPLOYMENT.md`'s marketing-site step still told readers to deploy
`examples/astro-site` to Cloudflare Pages with no explanation of why, sitting right next to the
Admin Worker's step above it — which had, in a previous pass, deliberately moved *away* from
Pages onto Workers Static Assets — with nothing distinguishing "we're still using Pages here" from
"we moved away from Pages." Fixed by making the distinction explicit in that section: Pages is
this example's target only because it's `@astrojs/cloudflare`'s own adapter default, not a
CMS-wide recommendation, and readers targeting Workers Static Assets (or any other host) for their
own Astro/framework site should just use that instead — nothing about the CMS's own two Workers
depends on this example's deploy target. The root README's "Astro Integration is done and
production-deployable" line was also tightened to separate two different claims that single
sentence had been conflating: the `@kenresoft-cms/astro` client library itself (SSR-verified
against a real deployed API — genuinely done) versus the `examples/astro-site` reference site's
own deployment (never actually deployed to a live Cloudflare project by this project, confirmed by
re-reading this file's own C1/production-reset entries above, which cover the CMS's two Workers
only). (3) The root README's install section led with `npm create @kenresoft-cms@latest`
immediately above a later "this repo uses pnpm exclusively, do not use npm or yarn" statement,
with nothing connecting the two — a genuinely reasonable point of confusion for a first-time
reader, even though the two aren't actually contradictory (`npm create <pkg>` is npm's standard,
zero-install bootstrap convention akin to `npm init`, not a statement that the resulting project
uses npm). Fixed with a one-line clarification in both places: right after the install command,
and in the "Package manager" section itself, so whichever one a reader lands on first resolves the
apparent conflict.

**Dependency security updates (Dependabot alerts closed)** (2026-09-03, prompted directly by a
user request after GitHub reported 72 open alerts, 3 critical) — done, with one deliberately
accepted exception and three real bugs found and fixed along the way. Bumped: `better-auth`
1.4.21 → 1.7.2 (both `apps/api`/`apps/admin`), `astro` ^5.1.0 → ^7.3.0 and `@astrojs/cloudflare`
^12.6.13 → ^14.3.0 together in `examples/astro-site` (the adapter's 14.x line requires Astro
^7.2.0, confirmed via its own published `peerDependencies` rather than assumed), `wrangler`
^4.42.4 → ^4.128.0 and `@cloudflare/workers-types` → ^5.20260903.1 everywhere either is pinned.
Two purely-transitive dependencies with no fix yet in their actual parent packages (`qs` via
`shadcn`'s bundled MCP SDK → express → body-parser; `esbuild` via `drizzle-kit`'s still-unfixed
`@esbuild-kit/core-utils` chain) are forced to safe versions via a `pnpm.overrides` block — which,
confirmed empirically (an override set to a nonexistent version correctly made `pnpm install`
fail), actually still belongs in `package.json`'s `"pnpm"` key for the exact pnpm version this
repo pins, not `pnpm-workspace.yaml` despite that being current pnpm's own documented location and
despite this pnpm version's own install output claiming the `package.json` key is "no longer read"
— a real, confirmed-misleading warning in this version, not a hint to actually act on.

One alert deliberately left open, not silently dropped: `@cloudflare/vitest-pool-workers@0.9.14`
(a `apps/api`-only devDependency) pins an internal `wrangler@4.44.0`, itself flagged for a "high"
command-injection CVE in `wrangler pages deploy`'s `--commit-hash` handling. Real-world
exploitability here is nil — this transitive copy is invoked only to simulate the Workers runtime
for local test runs, and this codebase never calls `wrangler pages deploy` from any test, script,
or CI step — but it was still worth a real attempt to fix rather than dismiss outright. Bumping
`@cloudflare/vitest-pool-workers` to its current 0.22.0 turned out to be a real breaking migration,
discovered empirically rather than assumed: the package's own architecture changed from a custom
Vitest "pool" (`defineWorkersConfig()`) to a Vite/Vitest **plugin** model (`cloudflareTest()` composed
with plain `defineConfig`, confirmed via Cloudflare's current Vitest-integration docs) — every one
of this project's 29 test files depends on the old ambient `cloudflare:test` types and the old
config API, so adopting it would mean rewriting the whole test harness, not a version bump. A
narrower, scoped `pnpm.overrides` entry (`"@cloudflare/vitest-pool-workers>wrangler": "^4.59.1"`)
was tried next — it resolved cleanly, but broke the test runtime outright (a malformed
`file:`-prefixed module path inside `vitest@3.2.7`'s own worker-thread loader, traced to the newer
wrangler pulling in an incompatible newer `miniflare`/`workerd` pairing that `vitest-pool-workers
0.9.14`'s own worker-loading code wasn't built against) — confirmed by reproducing the exact
failure, then reverting and confirming the suite passed again immediately. Left as an accepted,
documented, low-real-risk gap rather than destabilizing the entire test suite for a devDependency
whose actual attack surface doesn't apply to this project at all.

Two real, unrelated bugs surfaced purely by attempting the upgrade, not something anyone flagged
in advance: (1) an interrupted `pnpm install --force` (hit mid-run by a real Windows file-lock
EPERM, not this session's fault) had silently left `@rolldown/binding-win32-x64-msvc` on disk with
only its 21MB native `.node` binary and no `package.json` — enough for a direct `require()` of the
binary to work, but not enough for Node's module resolution to find any entry point at all, which
broke `astro check` specifically (Vite 8's new Rust bundler) with a confusingly-unrelated-looking
"Cannot find native binding... npm has a bug" error. Fixed by deleting just that one corrupted
package directory and letting pnpm re-link it from the store — confirmed via `astro check` passing
clean afterward, not just assumed fixed. (2) `apps/admin/src/components/two-factor-settings.tsx`
broke at typecheck, exactly matching a breaking change flagged in better-auth 1.7's own release
notes: `enable()`'s resolved data is now a discriminated union on a new `method` field (`"otp"` |
`"totp"`) rather than always exposing `totpURI`/`backupCodes` directly. Fixed by narrowing on
`method !== 'totp'` before reading either field (this project only ever enrolls TOTP, never
OTP-by-email/SMS) — caught by the type system, not by a test, though `ProfilePage.test.tsx`'s own
mock needed the same `method: 'totp'` field added to keep matching the real shape.

The one change needing a real database migration, found only by running the actual test suite
against real D1 (not from any changelog): better-auth 1.7 scopes account identity by
`(issuer, accountId)`, not `accountId` alone, and refuses to start against a Drizzle schema
missing the new `account.issuer` column — surfacing as every single auth-touching test file
failing with `BetterAuthError: The field "issuer" does not exist in the "account" Drizzle
schema`. Fixed per better-auth's own 1.7 upgrade guide
(https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer):
added `account.issuer` (text, `NOT NULL DEFAULT 'local:credential'`) plus a unique index on
`(issuer, account_id)` (migration `0018_glamorous_leper_queen.sql`). The literal default value is
deliberately correct forever here, not just a one-time backfill convenience — this project only
ever creates credential (email/password) accounts, never social/OAuth/SIWE/SSO, so every account
row past and future gets the same deterministic namespace the upgrade guide specifies for that
case. Verified for real end-to-end, not just via the test suite: a from-scratch isolated
`wrangler dev` instance (dedicated port, freshly-migrated D1 state, the same root `wrangler.toml`
+ `--persist-to` combination the real Playwright E2E harness uses — an earlier verification
attempt against `wrangler.test.toml` instead surfaced a real "no such table" error that turned out
to be this session's own leftover zombie `wrangler dev` processes from earlier verification
attempts holding stale ports, not a product bug; found and cleaned up by PID, not worked around)
confirmed real sign-up and sign-in both succeed and issue a real session cookie. Full validation
after every change in this pass: clean typecheck/lint across the whole workspace, all 23
`apps/admin` test files (134 tests) and all 29 `apps/api` test files passing (individually,
per this project's standing Windows/workerd-resource-contention note — confirmed flaky-only by
re-running each file that failed as part of a larger batch on its own).

**Audit log extended to content/structural/auth activity** (2026-09-03, direct user request,
first of a two-part instruction — Live Preview is the follow-up entry below) — done. The
`audit_log` table and `recordAudit()` helper (`apps/api/src/lib/audit.ts`) already existed for
role changes, disabling, and ownership transfer (see the Owner-role entry above) — extended by
reusing that exact helper at every content/structural write path rather than building a second
mechanism: entry create/update/delete/publish/unpublish/restore (including per-item during bulk
import — `routes/admin/entries.ts`), content-type create/update, field create/update/delete/
reorder, form/form-field create/update/delete, and media upload/delete
(`routes/admin/{content-types,forms,media}.ts`). Auth events (`auth.sign_up`, `auth.sign_in`,
`auth.sign_in_failed`, `auth.sign_out`) needed a different mechanism, since they happen inside
better-auth's own request handler, not this codebase's route files: a global `hooks: { before,
after }` pair added to the `betterAuth({...})` call in `apps/api/src/lib/auth.ts` (not
`auth-options.ts`, which has no `db` in scope — same reason `databaseHooks` already lives in
`auth.ts`), using `createAuthMiddleware` from `better-auth/api`. Sign-in success/failure and
sign-up are detected in an `after` hook by checking `ctx.path` against `/sign-in/email`/
`/sign-up/email` and inspecting `ctx.context.newSession` (present on success) vs.
`ctx.context.returned instanceof APIError` (present on failure) — both confirmed by reading
better-auth's own `dispatch.mjs` (`internalContext.context.returned = result.response` is set
to the endpoint's real success-or-caught-error result *before* after-hooks run), not just
trusted from docs. Sign-out needed a `before` hook specifically: by the time an `after` hook
could run, better-auth's own `/sign-out` handler has already deleted the session row, losing the
user id — the `before` hook instead reads the same signed cookie the real handler does
(`ctx.getSignedCookie` + `ctx.context.internalAdapter.findSession`, copied from better-auth's own
sign-out route source) one step earlier, read-only. New `GET /api/v1/admin/audit-log`
(`requireRole('admin')`, matching the floor the user-management mutations that write most of
these rows already use) backs a new **Audit log** page (`apps/admin/src/pages/AuditLogPage.tsx`),
hidden from the sidebar/command-palette below admin (unlike Users/Settings, there's no
meaningful read-only view once the API 403s outright) — actor/action/date-range filters, the
action dropdown populated from whatever's actually been logged rather than a hardcoded list, and
a per-row metadata dialog. A new `audit_log_actor_user_id_idx` index (migration
`0019_warm_stranger.sql`) backs the actor filter; `packages/database/src/index.ts` gained `gte`
alongside the existing re-exported drizzle-orm operators (only `lte` existed before, needed for
the log's `from`/`to` date-range filter). Verified three ways: `apps/api/test/audit-log.test.ts`
(real D1, 4 tests covering every action category, the sign-in-failure actor-label/no-user-id
shape, and both filters), the full existing suite re-run clean (23 admin files/134 tests, 30 api
files), and a real live pass against an isolated `wrangler dev` instance driving actual HTTP
sign-up/sign-in/sign-in-failure/sign-out/content-type/field/entry/media calls — 25/25 real
assertions, including two real gotchas the vitest-pool-workers-based test suite didn't surface:
better-auth's origin-check middleware 403s a state-changing auth request (sign-out) with no real
`Origin` header against a live Worker (a real browser always sends one; the test suite's
`SELF.fetch` apparently doesn't need one for reasons internal to that harness), and a raw
`fetch()` POST with a `Content-Type: application/json` header but a truly empty body 400s as
"Invalid JSON in request body" against real `wrangler dev` (better-auth's own client SDK always
sends a real, even if empty-object, JSON body, so real callers — `authClient.signOut()` in
`AppLayout.tsx` — never hit this; only a hand-written verification script needed the fix).

**Correction: the audit-log commit above broke CI on the first push** — `test/audit-log.test.ts`
called `/sign-in/email` with a deliberately wrong password through real D1/real better-auth, the
exact same pre-existing better-auth/better-call unhandled-rejection quirk commit `6b041b9`
already worked around for `security-elevate` (confirmed identical: `grep`-ing every other test
file's own comments turned up the exact same wrong-password-avoidance note already present in
`owner-protection.test.ts` and `password-reset.test.ts`, meaning this file was the only one that
reintroduced it, not a new discovery). Fixed by dropping the wrong-password call and its
`auth.sign_in_failed` assertion from this file, same as those two already do — that behavior stays
verified by the real live `wrangler dev` pass documented above instead, which does exercise it and
passed. Confirmed the fix locally first (the file alone: clean, no unhandled-error section), then
via CI going green on the re-push.

**Live Preview** (2026-09-03, the second of the two-part instruction that opened with audit
logging above) — done: a real render of a draft (or any-status) entry through the actual public
frontend's own templates, not just the Entry Editor's existing in-admin Preview tab (a plain data
dump, never a real layout/template). The core constraint — Phase 6's "a draft 404s exactly like a
nonexistent slug" guarantee on the *normal* public API must stay completely unchanged — is met by
never touching that route at all: Live Preview is an entirely separate, additively-mounted public
route, `GET /api/v1/public/preview/{contentType}/{slug}?token=...`
(`apps/api/src/routes/public/preview.ts`), which returns an entry of *any* status but only with a
valid, signed, entry-scoped, time-limited (15 min) token — missing/wrong/expired/wrong-entry all
collapse to the same 404 `routes/public/content.ts` already uses for a real draft, so probing this
route without a token reveals nothing either. `GET /api/v1/admin/entries/{id}/preview-token`
(`routes/admin/entries.ts`, no role gate beyond authentication — generating a token proves and
writes nothing, matching entries' own read routes) issues the token. Signing
(`apps/api/src/lib/preview-token.ts`) uses a key *derived* from `BETTER_AUTH_SECRET` via HMAC
(`HMAC(BETTER_AUTH_SECRET, "kenresoft-cms:preview-token:v1")`) rather than the raw secret or a new
required deployment secret — zero-config for every existing deployment (no new secret to set
before `pnpm run update` picks this up) while keeping the preview-signing key distinct from the
session-signing one. Since the CMS is frontend-agnostic (docs/ARCHITECTURE.md §15) and has no way
to know an arbitrary frontend's own URL routing, a new `settings.previewUrl` column (migration
`0020_slim_swarm.sql`, configured from Settings → API's new "Live Preview" section) holds a
`{contentType}`/`{slug}`-templated URL the operator supplies to match their own site — for
`examples/astro-site` locally that's `http://localhost:4321/blog/{slug}` (it only reads `{slug}`,
since it hardcodes one content type to `/blog`). The Entry Editor's new "Live Preview" button
(`EntryEditorPage.tsx`) fetches a token, substitutes the template, and `window.open()`s it in a
new tab — a new tab rather than an inline split-screen/iframe, so the editor sees the real
frontend at real size with its own responsive behavior and browser chrome, and so nothing depends
on the target site's own X-Frame-Options/CSP allowing itself to be framed by the admin's different
origin. Deliberately built from the *saved* entry, not in-progress form edits (disabled with a
toast nudging the editor to save first if the form is dirty) — Live Preview shows what will
actually render through the real templates right now, which is only true of what's already
persisted. `@kenresoft-cms/astro` gained `entries.preview({contentType, slug, token})`, mirroring
`entries.get()`'s shape exactly; `examples/astro-site`'s `blog/[slug].astro` checks for a
`?preview_token=` query param and calls it instead of `entries.get()` when present, rendering a
small "Preview mode" banner through the same template so an editor previewing a page can't
mistake it for the live site.

Verified three ways. (1) `apps/api/test/live-preview.test.ts` (real D1, 5 tests): the normal
public route's unchanged 404-for-a-draft behavior (explicitly re-asserted, not just assumed
untouched, by diffing its response against a genuinely nonexistent slug's), a full token-generate-
then-preview round trip for both a draft and an already-published entry, and rejection of no
token/a garbage token/a different entry's own valid token. (2) `EntryEditorPage.test.tsx` gained
two tests: the button's fetch-token-then-`window.open()`-with-the-right-URL flow, and the
save-first nudge when the form is dirty. (3) A real, live pass end-to-end through the actual
rendered frontend, not just the API: built `examples/astro-site` for real
(`PUBLIC_KENRESOFT_CMS_URL` pointed at an isolated local `wrangler dev` API instance) and served
that build with `wrangler dev --config dist/server/wrangler.json` (the config `@astrojs/cloudflare`
itself generates) — confirmed the normal URL 404s a real draft entry, then confirmed the preview
URL (a real token from the real admin API) rendered the actual draft title/body through the real
`BaseLayout` template with the preview banner visible, HTML captured and read directly rather than
just trusting a 200 status.

That live pass surfaced two real, unrelated bugs along the way, both fixed, neither hypothetical.
(1) `astro dev`'s real-workerd-backed dev server (a behavior change starting at `@astrojs/
cloudflare` v13, confirmed via that package's own changelog, not assumed) crashed on startup with
no forwarded error — root-caused, not guessed, to the adapter auto-wiring a KV-backed session
driver by default as of v14, which needs local KV simulation this project never provisions (no
wrangler config exists for this example at all, deliberately, since it has no bindings of its own
to declare). Fixed with `cloudflare({ session: false })` in `astro.config.mjs` — this example has
no server-side session state of its own; every page is a stateless per-request fetch from the CMS
public API. (2) Once startup was fixed, `astro build` failed outright with a real module-
resolution error ("`./_internal/logger` is not exported... from package astro") — this project's
own dependency-security pass earlier the same day had bumped `astro` to `7.3.0` and `@astrojs/
cloudflare` to `14.3.0` together and verified `astro check` (typecheck) passed, but never actually
ran `astro build` for this one package afterward (the root `pnpm build` script's filter
deliberately excludes `examples/*`/`integrations/*`, so this broke silently and stayed broken
until this session's own live-preview verification happened to be the first thing to actually
build it). Fixed by bumping `astro` to the `7.3.1` patch release (confirmed via `npm view` that
one existed) — build succeeded immediately after, no further changes needed. Neither issue was
present in `astro check`'s typecheck-only coverage; both needed an actual `build`/`dev` run to
surface, which is exactly why this feature's own verification insisted on one rather than stopping
at typecheck/lint/unit-test green.

**Real-deployment shakedown: five genuine bugs found via live `wrangler tail`, not by reading code**
(2026-09-03/04, prompted by the user doing a real first-time install — `npm create
@kenresoft-cms@latest real-test` — and reporting exactly what they hit) — done. None of these were
hypothetical: every one was root-caused against `real-test`'s actual deployed Worker, several only
after tailing live logs while the user reproduced the failure in their own browser.

1. **Every `/api/v1/auth/*` 429 showed the wrong error message everywhere.**
   `apps/api/src/middleware/auth-rate-limit.ts` returned a plain `{ error: "Too many requests..." }`
   string body. better-auth's client surfaces a JSON error body's top-level `message` field as
   `error.message`; a bare string left `.message` undefined, so every caller's own
   `authError?.message ?? '<fallback>'` silently showed its hardcoded fallback instead — reported
   by the user as two-factor enrollment saying "check your password" on a correct password. Fixed
   to `{ code, message }`, matching better-auth's own shape.
2. **`pnpm run setup`'s Resend email step silently never activated.** `maybeSetUpEmail()` guarded
   its `EMAIL_PROVIDER`/`EMAIL_FROM` insertion with `toml.includes('EMAIL_PROVIDER =')` — which
   also matched `wrangler.toml`'s own committed, commented-out example line
   (`#   EMAIL_PROVIDER = "cloudflare"   # or "resend"`), so the check was always true and the
   insertion always skipped. `RESEND_API_KEY` still got set as a secret regardless (that part had
   no such guard), so a deployment looked fully configured — the key was there — while
   `EMAIL_PROVIDER` stayed unset and the app kept using the no-op sender. Fixed by anchoring to an
   actual, non-commented line (`/^EMAIL_PROVIDER\s*=/m`).
3. **The `two_factor` table was missing three columns better-auth 1.7's plugin now requires.**
   The rate-limit fix above didn't actually fix 2FA enrollment — confirmed by tailing the live
   Worker while the user retried and catching the real error: `BetterAuthError: The field
   "verified" does not exist in the "twoFactor" Drizzle schema`. Exactly the same class of gap as
   the `account.issuer` fix from the earlier dependency-security pass — `@better-auth/cli`'s
   schema generator still bundles its own internal ~1.4.x better-auth copy, so this table was
   never regenerated against the 1.7.x runtime's actual expectations, and nobody re-ran the 2FA
   flow live after that version bump to notice. Confirmed the exact required shape against the
   installed package's own `dist/plugins/two-factor/schema.mjs` rather than guessing: added
   `verified` (boolean, default `true` — this app's two-step `enable()` → `verifyTotp()` flow
   never creates an unconfirmed row), `failedVerificationCount`, and `lockedUntil` (migration
   `0021_bitter_jubilee.sql`). Re-verified live afterward: the same enrollment attempt that
   previously threw now completed with no error.
4. **The documented git-based update path was broken for every `npm create` install, not just a
   rough edge.** The user asked, reasonably, why an update needed three commands instead of one.
   Tracing that surfaced a real architectural bug: `packages/create` scaffolded via a GitHub
   tarball download plus a fresh `git init` + one throwaway commit, which shares zero commit
   ancestry with the real upstream repo. `git merge upstream/<branch>` refuses outright
   ("refusing to merge unrelated histories") — and forcing it through with
   `--allow-unrelated-histories` alone still turned *every* file any upstream commit had touched
   since scaffold time into a spurious "add/add" conflict, confirmed by hand against `real-test`
   (23 conflicted files), even where the content hadn't actually diverged, because there was no
   common ancestor for git to 3-way-diff against. Fixed at the root: `packages/create` now does a
   real `git clone` (`--origin upstream`, real shared history, no `tar` dependency needed anymore)
   instead of tarball+init, so every future scaffold merges cleanly forever after. `pnpm run
   update` also now pulls the code itself as its first step (new `scripts/lib/git-cli.mjs`) rather
   than assuming the user already ran `git fetch`/`git merge` by hand — it's now genuinely the one
   command the docs already claimed it was. An install scaffolded *before* this fix (like
   `real-test`) still needs one one-time, explicitly-confirmed reconciliation merge
   (`--allow-unrelated-histories -X theirs` — safe specifically because a scaffolded install has
   no real local code edits to lose, only config, which is stashed/restored separately) the first
   time it updates; `pullLatestCode()` detects this case, explains it, and asks before proceeding.
   Verified for real end-to-end against `real-test`, twice: once hitting the unrelated-histories
   wall and resolving it, once confirming the *next* update after that is a normal, silent,
   conflict-free merge.
5. **A single misconfigured webhook could retry the same failed delivery forever, throwing on
   every 5-minute cron tick.** Found via the same live `wrangler tail` session: a webhook pointed
   at `https://kenresoft-cms-admin.kenresoft.workers.dev/settings` (the admin Worker's own
   static-assets page — not a real receiver, leftover from trying out the Webhooks feature)
   triggered "A stalled HTTP response was canceled to prevent deadlock" on POST, and the
   `recordWebhookDelivery()` insert that followed threw — uncaught, since unlike the `fetch()`
   call right above it, that insert had no try/catch. Since that write is the only thing that ever
   advances a delivery's `attempt` counter, the failure meant `listDeliveriesToRetry` found the
   exact same row again every cycle, forever, instead of the bounded `MAX_DELIVERY_ATTEMPTS`
   retries this is supposed to have. Fixed by catching and logging instead of throwing (still
   visible via `wrangler tail`, just not an uncaught exception); the stale webhook and its stuck
   delivery rows were also deleted from `real-test`'s D1 directly.

All five fixed, committed, and pushed to `develop` individually (not batched — each was found,
root-caused, and verified independently in the course of walking through the user's real install),
and `real-test` was brought fully current with every fix via the now-fixed `pnpm run update` path
itself, closing the loop on finding #4 using the very fix it produced.

**Plugin platform, Phase 1** (2026-09-04, on `feature/plugin-platform` off `develop` — an
externally-authored architecture spec asked for Kenresoft CMS to evolve into a plugin-extensible
platform, Commerce eventually as the first real vertical plugin; Phase 1 explicitly required
zero Commerce logic, proven only via a trivial `packages/plugin-hello` package first) — done,
see `docs/PLUGINS.md` for the full design. New `@kenresoft-cms/plugin-sdk` (`packages/plugin-sdk`,
internal-only, modeled on `packages/database`'s no-build-step template) is the one package both
`apps/api` and every plugin depend on symmetrically: `PluginManifest`/`pluginManifestSchema`,
`PluginContext` (db/user/hasRole/media/config/events/logger), `PluginRegistration`,
`requirePluginRole()` (rebuilt from the same `roleAtLeast()`/`UserRole` primitives
`requireRole()` already uses — Phase 1 permission enforcement reuses Core's existing 5-role
hierarchy wholesale, `manifest.permissions` stays discovery metadata only), and
`createPluginOpenApiApp()` (mirrors `apps/api/src/lib/openapi.ts`'s validation-error shape).
`packages/plugin-hello` is the Phase 1 acceptance proof: one migration
(`plugin_hello_greetings`), one API route mounted at `/api/plugins/hello/v1/*`
(`apps/api/src/plugins/mount.ts`, the one new composition point `index.ts` calls — `index.ts`
itself never imports a specific plugin, only `apps/api/src/plugins/registered-plugins.ts` does),
one admin nav entry + page, one editor-gated permission, one configurable greeting, and one
in-process event.

The one real architectural tension the source spec itself asked to be surfaced rather than
silently resolved: this deployment has exactly one D1 database and one `drizzle-kit generate`
pipeline, so a plugin's table is physically defined in `packages/database/schema/plugins/<id>.ts`
(prefixed `plugin_<id>_`), not inside the plugin package itself — "ownership" here is a naming
convention plus "only that plugin's own repository file ever queries it," not a physically
separate migration history. `PluginContext.db` is likewise the same singular `Database` type
Core repositories use, an explicitly temporary, convention-enforced (not mechanical) boundary.
Admin UI is deliberately split rather than colocated (confirmed with the user during planning):
a plugin's nav entry/page live in `apps/admin/src/plugins/<id>/`, registered in a small static
array mirroring `apps/admin/src/pages/settings/sections.tsx`'s existing registry pattern — not
inside the plugin package — specifically so `apps/admin` keeps its documented standalone-clone
property (`@kenresoft-cms/contracts` via a published npm version, not `workspace:*`) intact for
every deployment, at the cost of a plugin's admin contribution being split across two locations.
Events (`apps/api/src/plugins/events.ts`) are explicitly in-process/best-effort/synchronous only,
documented plainly as not a substitute for the existing DB-backed, Cron-retried webhook mechanism
for anything that actually needs durability. `plugin_settings` (new Core-owned generic table,
`packages/database/schema/plugin-settings.ts`) holds only non-secret plugin config, gained a
`configVersion` column for future config-shape migrations, and documents the same "secrets go
through `wrangler secret put`, never a database column" rule the rest of this file already
follows. One existing Core file got a behavior-preserving touch: `routes/admin/media.ts`'s inline
R2 upload/delete logic was extracted into `apps/api/src/lib/media-service.ts` so the SDK's
`MediaService` genuinely wraps the same code path — verified against the existing
`media-routes.test.ts` assertions, zero behavior change. New tests:
`apps/api/test/plugin-registry.test.ts` (registry validation: duplicate ids, malformed manifest,
unsupported `sdkVersion`, unresolved dependencies — against a fabricated plugin list, never the
real import) and `apps/api/test/plugin-hello.test.ts` (real D1: the health-check route, the
editor-role gate, the configured-greeting-prefix path, the event firing on create); admin gained
`HelloPage.test.tsx` and an `AppLayout.test.tsx` case for the new "Plugins" nav group. Commerce
(Phase 2) is explicitly not started — no Commerce schema, route, or admin page exists anywhere.

**Dependabot alert cleanup: 19 of 20 closed via a narrower override than the one that failed
before** (2026-09-04) — GitHub reported 20 open alerts (8 high, 10 moderate, 2 low) after the
plugin-platform push; investigated for real rather than assumed stale. All 20 traced to exactly
one root cause: `apps/api`'s `@cloudflare/vitest-pool-workers@0.9.14` devDependency pins its own
internal `wrangler@4.44.0`, which drags in an old `miniflare@4.20251011.0` that hard-pins
`undici@7.14.0` (16 of the 20 alerts alone), `sharp@^0.33.5`, and `ws@8.18.0` — every other copy
of these three packages across the workspace was already on a patched version (confirmed via
`pnpm why <pkg> -r`). This is the exact same devDependency already flagged as a deliberately
accepted risk in this file's "Dependency security updates" entry above, where bumping the pool
package to 0.22.0 turned out to be a real breaking test-harness migration, and a scoped
`pnpm.overrides` on `@cloudflare/vitest-pool-workers>wrangler` resolved cleanly but broke the
test runtime outright (an incompatible miniflare/workerd pairing). Checked whether anything had
changed since: `@cloudflare/vitest-pool-workers`'s latest is still 0.22.0, same architecture,
same migration cost — not attempted again.

What's different this time: `undici`/`sharp`/`ws` are leaf packages the old miniflare bundles for
its own polyfills, not the CLI/workerd pairing itself that broke last time — overriding just
those three (`package.json`'s `pnpm.overrides`, leaving the internal `wrangler`/`miniflare`
untouched) sidesteps the exact coupling that broke the runtime before. Verified for real, not
assumed safe: `pnpm why <pkg> -r` confirmed all three resolved to patched versions inside the
`vitest-pool-workers` subtree specifically, then the *entire* `apps/api` suite (34 files) and the
*entire* `apps/admin` suite (24 files, since `jsdom`→`ws` runs through the same override) were
re-run individually/in small batches per this file's own standing Windows/workerd-flakiness
practice — real D1, real R2, a real `fetch()` through workerd's `undici` (webhook dispatch to an
unreachable host), real media upload/sniffing — all passing, plus a clean `pnpm typecheck`/
`pnpm lint` across the whole workspace. The one alert left open is the `wrangler@4.44.0` CVE
itself (OS command injection in `wrangler pages deploy`) — unchanged from the already-documented
reasoning: this transitive copy is never invoked with that subcommand by anything in this
codebase, and actually replacing it is the same rejected 0.22.0 migration.

**Plugin enablement: DB-backed and live-toggleable, superseding part of Phase 1's design**
(2026-09-04, on `feature/plugin-enablement` off `develop`) — done. Prompted by a direct question
mid-way through planning Commerce: shouldn't a self-hosted operator see which plugins are
bundled and toggle them on/off in the admin UI, rather than editing a file and redeploying? The
honest constraint is unchanged (Cloudflare Workers still bundle plugin *code* at build time — no
Dynamic Worker Loader, no runtime remote-code loading, per the source spec's own non-goals), but
*whether* an already-bundled plugin is switched on no longer has to be. `apps/api/src/plugins/
plugins.config.ts` (a static file, edit-and-redeploy to toggle) is deleted, replaced by a new
Core-owned `plugin_enablement` table (`packages/database/schema/plugin-enablement.ts`, no row
for a plugin id means enabled by default) and a new `GET`/`PATCH /api/v1/admin/plugins` route
pair backing a new admin "Plugins" page (`apps/admin/src/pages/PluginsPage.tsx`) — toggling takes
effect immediately, no redeploy; adding a genuinely new plugin still requires a code change (the
package + one line in `registered-plugins.ts`) and a redeploy, which doesn't change.

The real architectural shift this forced: Phase 1's `ENABLED_PLUGINS` was resolved once,
synchronously, at Worker module-load — before any request (and therefore any D1 binding) exists.
Making enablement DB-backed meant that decision had to move to per-request time.
`apps/api/src/plugins/registry.ts`'s `resolvePlugins()`/`ENABLED_PLUGINS` became
`validatePlugins()`/`VALIDATED_PLUGINS`, narrowed to only what cold-start actually can decide
(manifest shape, `sdkVersion`, duplicate ids); a new `apps/api/src/plugins/enablement.ts`'s
`requirePluginEnabled(pluginId)` — applied at the top-level app *before* `requireSession` for
every plugin's mount point — does the live check instead, 404ing unconditionally regardless of
auth state (matching this codebase's existing "disabled/unconfigured ⇒ indistinguishable from
not installed" convention) and re-checking that the plugin's declared dependencies are
*currently* enabled too, not just installed. Hono's route composition itself is unchanged — every
validated plugin still mounts unconditionally at cold start; only request handling is now gated.
One extra D1 read per plugin-route request is an accepted, documented cost, not solved
speculatively with cross-request caching a stateless Workers request can't safely do anyway.

Completing the feature meant the admin nav had to become live-aware too, not just the API:
`apps/admin/src/plugins/registry.ts`'s `PluginNavItem` gained a required `pluginId`, and both
`AppLayout.tsx` and `command-palette.tsx` now filter `pluginNavItems` against a new
`usePlugins()` hook before rendering — a disabled plugin's sidebar link and palette entry
disappear instead of just 404ing when clicked. The list endpoint itself is readable by any
authenticated role (not admin-gated like `PATCH`), specifically because every role's nav needs
to know current enablement state — a real design correction made during this pass, not the
original plan (which would have made non-admin nav rendering fail against an admin-only
endpoint). `docs/PLUGINS.md`'s Enablement section was rewritten in place rather than left
contradicting the new code.

**Fix: `pnpm run setup` crashing outright with "A database with that name already exists"**
(2026-09-04, direct user report — several people running this open-source template kept hitting
it) — done. `ensureD1()`/`ensureR2()` hardcoded the literal names `kenresoft-cms-db`/
`kenresoft-cms-media` for every fork, and `wrangler d1/r2 ... create <name>` unconditionally
crashed the whole script the moment that name already existed in the target Cloudflare account —
which D1/R2 names only have to be unique *within*, not globally. Two real, common triggers:
someone re-running setup after an earlier attempt created the resource but exited before writing
its id into `wrangler.toml` (a re-clone into a fresh directory instead of reusing the same one is
enough to lose that), and — more likely the recurring case — one Cloudflare account hosting more
than one deployment of this same template (an agency running several client sites from a single
account), where every fork after the first collides on the exact same default name.

Fixed by catching that specific failure (confirmed against real Cloudflare infrastructure, not
guessed: created a throwaway D1 database and R2 bucket, then tried creating each a second time —
D1 replies "A database with that name already exists", R2 replies "The bucket you tried to
create already exists, and you own it. [code: 10004]", both matched by one `/already exists/i`
check) and asking for a different name instead of crashing, with an auto-generated suggestion
(the default plus a short random suffix) so accepting it is just pressing Enter. Verified live,
not just unit-reasoned: the retry path was driven against the real duplicate-name collision above
and correctly created a second, differently-named database.

The one thing this couldn't safely do is let `database_name`/`bucket_name` silently drift from
whatever every *other* script assumes. `wrangler d1 info`/`wrangler r2 bucket info` (this file's
own existence checks) only accept the resource's real name, confirmed via `--help` output ("The
name of the DB"/"The name of the bucket to retrieve info for") — no binding fallback — so
`ensureD1()`/`ensureR2()` now always read the *actual* current name back out of wrangler.toml
(`extractTomlValue()`) instead of assuming the hardcoded default, and always write the real
chosen name back after a rename, so a later re-run's existence check stays correct. Every other
consumer that used to hardcode the literal database name as a CLI argument — `scripts/setup.mjs`'s
own migrations-apply step, `scripts/update.mjs`, `packages/database/package.json`'s four
`migrate:*` scripts, and `apps/api/scripts/recover-owner.mjs`'s `d1 execute` calls — was switched
to the binding `"DB"` instead, confirmed safe via `wrangler d1 migrations apply --help`/
`wrangler d1 execute --help` (both explicitly document accepting "The name or binding of the
DB"), so all four stay correct regardless of what the database ends up actually named. R2 has no
such binding-based CLI resolution (`wrangler r2 object get/put` always take the bucket's real
name), so `apps/api/scripts/backup-media.mjs`'s `BUCKET_NAME` constant stays a documented manual
override — its existing comment now also calls out this rename scenario, not just the two it
already covered (an explicitly-named bucket vs. one left to wrangler's own auto-provisioning).

**Fix: `pnpm run update` silently overwrote a different deployment's live Worker, and could run
before setup ever completed** (2026-09-05, two direct user reports — one confirmed as a real
production incident: `pnpm run update` replaced another, unrelated deployment's live API Worker
sharing the same Cloudflare account and default name, "even the admin [Worker] too") — done, and
the more serious sibling of the D1/R2 fix above. `wrangler deploy` has no "already exists"
failure mode the way `d1/r2 ... create` does — every fork of this template ships the same
default Worker names (`kenresoft-cms-api`/`kenresoft-cms-admin`), and deploying to a name already
taken by an unrelated Worker in the same account (the exact scenario the D1/R2 fix's own
collision handling exists for) just silently overwrites it. No error, no warning — confirmed as a
real incident, not a hypothetical.

Fixed with a new `checkWorkerOwnership()` (`scripts/lib/deploy-helpers.mjs`), verified against
real Cloudflare infrastructure end to end (all three outcomes below reproduced against a real
throwaway Worker before shipping): `wrangler versions view <id> --name <name> --json` returns a
version's full binding list, including the D1 binding's `database_id` — comparing the *live*
Worker's currently-bound database against this install's own wrangler.toml `database_id` (a
genuine per-clone fingerprint, especially now that the D1/R2 fix above can make it diverge from
every other clone's) reveals whether a same-named Worker is really still ours: no Worker at all
→ `'new'` (safe, nothing to conflict with); live binding matches → `'ours'` (safe, a genuine
re-run); live binding differs (or is missing entirely) → `'foreign'` (dangerous — belongs to a
different deployment).

`scripts/setup.mjs` gained `ensureWorkerNamesAreOurs()`, run once right before the very first
deploy of a run: on `'foreign'`, it explains what's happening and asks for a different Worker
name (an auto-generated suggestion, same UX as the D1/R2 fix) rather than proceeding — and
because a genuine re-run of an already-established install always resolves `'ours'`, it never has
to ask twice. The admin Worker has no bindings of its own to check ownership *by* (it's
assets-only), so it isn't independently verified — instead, only if the API Worker's default name
had to change (strong evidence this account already has another install of the project occupying
the paired default names) is the admin Worker's name *derived* from the now-confirmed-safe API
name (`-api` → `-admin`) and checked for plain existence, retrying with a fresh suffix on the
vanishingly unlikely chance that also collides. `scripts/update.mjs` runs the same API-Worker
check before every redeploy but, unlike setup.mjs, hard-refuses outright on `'foreign'` rather
than prompting — it's designed to run with zero prompts, and there's no safe automatic choice to
make on the update path; only setup.mjs's interactive collision handling can pick a new name. An
install already affected by this bug recovers by running `pnpm run setup` again (not `update`) —
it detects the live mismatch the exact same way and walks through the same interactive rename.

The second report: `pnpm run update` run before `pnpm run setup` had ever completed could silently
half-provision a deployment — wrangler's own automatic provisioning still fires on the first
`wrangler deploy` even via `update`, but every *other* step only `setup.mjs` performs
(`BETTER_AUTH_SECRET`, CORS wiring, the admin origin) never runs, leaving a Worker that's live but
broken (better-auth's "you are using the default secret" on every request) with no obvious cause.
Fixed with a purely local, network-free check: a never-set-up clone's wrangler.toml has no
`database_id` at all (only `ensureD1()` in setup.mjs ever writes it in), so `update.mjs` now
refuses outright with a clear "run `pnpm run setup` first" message instead of proceeding. Both new
`update.mjs` checks read wrangler.toml *after* pulling the latest code, not a pre-pull snapshot —
what matters is the config actually about to be deployed. The shared TOML-reading logic (`readTomlFile`/
`findTopLevelBlock`/`extractTomlValue`/`readWorkerName`/`readDatabaseId`, plus the write-side
`writeTomlFile`/`writeWorkerName`) moved out of `scripts/setup.mjs` into a new
`scripts/lib/wrangler-toml.mjs` specifically so `update.mjs` could read the same structures
without duplicating the parsing logic — `readWorkerName`/`writeWorkerName` deliberately restrict
their match to a wrangler.toml's *preamble* (before the first `[section]`), confirmed necessary
by testing against the real files: a naive first-line-starting-with-`name = "` match would have
been ambiguous against the *different* `name = "..."` fields inside `[[ratelimits]]` blocks
further down the same file.

**`pnpm run rename-worker`, for changing a Worker's `*.workers.dev` URL after the fact** (2026-09-05,
direct user question — "is there a script for that?") — done. Cloudflare has no in-place Worker
rename: changing `wrangler.toml`'s `name` and redeploying creates a *new* Worker at the new URL,
the old one keeps running unmodified at its old URL, and every cross-reference the old URL was
stored in needs fixing up by hand otherwise — the API Worker's own URL is baked into the admin
build (`VITE_API_URL`) and stored in `BETTER_AUTH_URL`; the admin Worker's URL lives in the API's
`CORS_ORIGINS` and `ADMIN_URL`. `scripts/rename-worker.mjs` (`--target api|admin --name <new>`)
does the whole sequence: checks the new name isn't already taken by an unrelated Worker (reusing
`checkWorkerOwnership()` from the fix above — for the admin Worker, which has no bindings to
verify ownership *by*, it degrades to a plain existence check via an impossible sentinel
database id, same trick `ensureWorkerNamesAreOurs()` already uses), asks for confirmation before
doing anything, deploys the new Worker and updates every cross-reference (rebuilding+redeploying
the admin app for an API rename; updating `CORS_ORIGINS`/`ADMIN_URL` and redeploying the API for
an admin rename), then asks whether to delete the now-orphaned old Worker. The old admin URL
`replaceCorsOrigin()` needs to retire is derived from the *new* deploy's own URL suffix
(Cloudflare's workers.dev subdomain is fixed per account) rather than a second network round
trip. `ask()`/`confirm()` moved out of `scripts/setup.mjs` into a new `scripts/lib/prompt.mjs`
so this script didn't need a second, drifting copy.

**Investigated, not a Kenresoft CMS issue: a user's Astro site logging "your custom src/fetch.ts
does not call the actions()/middleware() handler"** (2026-09-05) — traced to source, not
guessed: read Astro 7.x's own `astro/dist/core/fetch/vite-plugin.js` (the warning only fires when
a project has its *own* `src/fetch.ts`, which Astro's `virtual:astro:fetchable` feature resolves
as a custom low-level fetch handler replacing the default one) and confirmed by actually running
`examples/astro-site` live — it has never had a `src/fetch.ts` at any point in its git history
and doesn't trigger the warning. `@kenresoft-cms/astro` is a plain fetch-wrapper client with zero
Astro integration hooks, so it can't be the source either. Conclusion: the affected user added
their own `src/fetch.ts` (for reasons outside this project's docs/template) that doesn't forward
through Astro's public `astro/fetch` API correctly. Documented as a troubleshooting entry in
`docs/ASTRO.md` (with the correct forwarding pattern, sourced from reading Astro's own default
handler implementation) in case a future user extending the example hits the same confusion —
nothing in this repo needed to change.

**Correction to the above**: the first version of that troubleshooting snippet had the export
shape wrong — `export default async function fetch(request) {...}` (a bare function). Astro
calls the handler as `fetchHandler.fetch(request)` (confirmed in `astro/dist/core/app/base.js`,
line ~270), a *method* call, not a direct invocation — so the default export must be an object
with a `fetch` method, matching the standard Cloudflare Workers module-worker shape
(`export default { fetch, scheduled?, ... }`) that `@astrojs/cloudflare` bridges to. The
original wrong shape would have thrown `fetch is not a function` at runtime the moment Astro
actually tried to invoke it. Caught and reported by the user who'd hit the original warning
(their own `src/fetch.ts` mistake, not this project's) before anyone copy-pasted the wrong
snippet from here. Fixed in `docs/ASTRO.md`.

**`globalVariables.list()` added to `@kenresoft-cms/astro`, and Settings.contactEmail/socialLinks
removed in favor of Global Variables** (2026-09-05, reported while migrating kenresoft.com's own
Astro site onto this CMS) — done, two related gaps closed together. First, a straightforward
addition: `GET /api/v1/public/global-variables` existed and worked but had no client wrapper,
so `integrations/astro/src/index.ts` gained `globalVariables.list()` (mirrors the existing
entries/media thin-wrapper style — throws `KenresoftApiError` on non-2xx, `{}` never `null` for
an empty map, since there's no per-key sub-resource to 404 on).

Second, a real architectural decision the report asked for directly: Settings had
`contactEmail`/`socialLinks` fields that looked purpose-built for public site metadata, but —
confirmed by grepping every consumer — had zero functional consumers anywhere in the codebase
and no public route of their own (unlike `corsOrigin`/`featureFlags`/`previewUrl`, which are
genuinely CMS-internal and gate real behavior). Global Variables already covered this exact use
case better: public, edge-cached, arbitrary key names instead of a fixed schema, and an existing
"Site Info" template. Decided in favor of Global Variables as the one home for this kind of data
and removed the Settings fields entirely, rather than leaving two overlapping mechanisms around
— which is exactly the duplication the report was written to flag (a real migration project had
already started hand-copying contact/social info into Global Variables as a stopgap).

Removal used a real migration (`0024_volatile_spiral.sql`), not just a schema change: verified
live against a real local D1 instance (pre-existing `contact_email` + `social_links` data
seeded, plus a *pre-existing* `social_twitter` Global Variable to prove the migration doesn't
clobber it) that the migration correctly copies any non-null `contactEmail` into a
`contact_email` Global Variable and each `socialLinks` key into `social_<key>`, skipping any key
that already exists, before dropping both columns. `apps/admin`'s Settings → Social section
(`SocialSection.tsx`) now explains the move and links to Global Variables instead of duplicating
the old fields; General lost its Contact Email field (Site name stays — it's the deployment's
own admin-facing identity, not site content). `docs/ASTRO.md` gained a "Where public site config
lives" section making this the documented, intended answer going forward, and `CHANGELOG.md`
flags it as a breaking change with the exact migration behavior spelled out, since an existing
deployment's admin-entered contact/social data is affected.
