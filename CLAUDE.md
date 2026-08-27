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

CI is green on `develop`.
