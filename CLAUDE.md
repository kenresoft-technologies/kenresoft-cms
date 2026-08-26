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
  Not yet done: any owner-only surface beyond content-type creation (no invite/promote flow
  exists yet), and select/multi_select option lists, media picker, and reference lookup
  fields all still render as plain text pending field-builder UI to configure them.
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
  null — VP8/VP8L/VP8X each encode dimensions differently), and no field type yet uses a media
  picker to reference an uploaded item (the `media` field type still renders as plain text,
  same gap noted under Phase 3).
- **Phase 6** (public/admin REST API + OpenAPI + public API caching) — in progress. Done:
  `GET /api/v1/public/:contentType` + `GET /api/v1/public/:contentType/:slug`, unauthenticated,
  addressed by content-type/entry slug rather than internal ids. Filters to `status =
  'published'` at the query layer (`getPublishedEntryBySlug`/`listPublishedEntriesFor
  ContentType` in `apps/api/src/repositories/entries.ts`) — a draft matching the requested
  slug 404s exactly like a slug that doesn't exist, never distinguishable from the outside.
  Not yet done: migrating routes to `@hono/zod-openapi` for generated API contracts, and the
  public API caching layer (Cache API/KV) — both independent, substantial slices of their own.

CI is green on `develop`.
