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
First production implementation: the Pathvera Group website. It is not a Pathvera-specific
dashboard, but it is also not a multi-tenant hosted service — it's **single-site-per-deployment**
(see `docs/ARCHITECTURE.md` §11): every deployment (its own Cloudflare account, D1, R2,
Worker) backs exactly one website. Additional clients get their own deployment of the same
open-source codebase, not a new tenant inside Pathvera's.

**Full architecture and technical specification: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**
— this is the source of truth for design decisions, domain model, API contract, security
rules, and the implementation roadmap. Read it before making architectural changes. Any
deviation from it should be recorded in its Changelog section.

**Monorepo layout** (pnpm workspaces):
- `apps/api/` — `@kenresoft/api` (Cloudflare Worker, Hono, D1, R2)
- `apps/admin/` — `@kenresoft/admin` (React + Vite admin SPA)
- `packages/database/` — `@kenresoft/database` (Drizzle schema, migrations, seed data)
- `packages/contracts/` — `@kenresoft/contracts` (shared Zod schemas / API contract)
- `packages/types/` — `@kenresoft/types` (shared TypeScript types)
- `packages/config/` — `@kenresoft/config` (shared ESLint/TS/Prettier config)

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
  an actual concern at Pathvera's traffic level.
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
  A new `@kenresoft/astro` workspace package (`integrations/astro/`) — a typed client
  (`createKenresoftClient`) wrapping the public API's `entries.list`/`entries.get`, deliberately
  without a `contentTypes.list()` since no public content-type-metadata endpoint exists to back
  one. `examples/astro-site` (previously a hand-rolled `fetch` wrapper) was rebuilt on top of
  it and brought into the pnpm workspace (`pnpm-workspace.yaml` now lists `integrations/*` and
  `examples/*`) so it can depend on `@kenresoft/astro` via a normal `workspace:*` link instead
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
  delete. `@kenresoft/astro` gained `media.url({ id })`; `examples/astro-site` now renders a
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
  reference). Roles/sessions/Users-UI items are done; the login-flow report is still open — an
  automated reproduction of the exact reported steps completed cleanly, which rules out the
  leading same-tab-redirect theory but hasn't identified a cause, so it needs more repro detail
  (exact URL/environment tested) before further diagnosis. Renamed `owner` → `admin`
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
