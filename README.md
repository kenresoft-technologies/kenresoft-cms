# Kenresoft CMS

A reusable, Cloudflare-native, API-first content management platform. First production
implementation: the Pathvera Group website.

Content lives in Cloudflare D1, media lives in Cloudflare R2, the API runs on Cloudflare
Workers (Hono), and the admin application talks only to the API — never to the database
directly.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture and technical
specification (source of truth for design decisions).

## Status

Phases 1–7 of the roadmap are done: Worker/Hono/D1/Drizzle foundation, the content-type/field/
entry domain model, admin auth with role-based authorization, draft/publish with scheduled
publishing and revisions, the R2 media library, the public + admin REST API (OpenAPI, edge
caching), and forms with spam/rate-limited public submissions. Three cross-cutting UI passes
on top of that took `apps/admin` from functional CRUD screens to a full admin experience —
dashboard, command palette, drag-to-reorder fields, a redesigned Settings area, unified Entries
and Submissions views, dark mode, and more. Phase 8's local Astro integration is also done —
see [`docs/ASTRO.md`](docs/ASTRO.md) — with production deployment still outstanding.

For the authoritative, continuously-updated account of what's done and what isn't, see the
**Status** section of [`CLAUDE.md`](CLAUDE.md). For the target end state, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §20 (Implementation Roadmap).

## Monorepo layout

```
apps/
  api/      @kenresoft/api    — Cloudflare Worker (Hono + D1 + R2)
  admin/    @kenresoft/admin  — React + Vite admin dashboard
packages/
  database/   @kenresoft/database   — Drizzle schema, migrations, seed data
  contracts/  @kenresoft/contracts  — Shared Zod schemas + API contract, used by api/admin/SDK
  types/      @kenresoft/types      — Shared TypeScript types
  config/     @kenresoft/config     — Shared ESLint/TS/Prettier base config
integrations/
  astro/      @kenresoft/astro      — Typed client for consuming the public API from Astro
docs/       Architecture and reference documentation, including docs/ASTRO.md
examples/
  astro-site/ Reference Astro site built on @kenresoft/astro — see its own README
tests/      Reserved for cross-package integration/E2E tests — not yet populated
```

## Getting started

```bash
pnpm install

# One-time local setup: secrets and the API URL the admin app talks to.
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then fill in BETTER_AUTH_SECRET
cp apps/admin/.env.example apps/admin/.env

# One-time (and after pulling new migrations): apply the schema to your local D1 database.
pnpm --filter @kenresoft/database migrate:local

pnpm build
```

`pnpm dev` at the repo root starts every app's dev server in parallel (API on
`http://localhost:8787` via `wrangler dev`, admin on `http://localhost:5173` via Vite). Each
can also be run independently — `pnpm --filter @kenresoft/api dev` /
`pnpm --filter @kenresoft/admin dev` — which is useful when you only need one of them running.

The first account created through the admin's sign-up flow becomes the deployment's owner;
everyone who signs up after that defaults to editor (see the Phase 3 entry in `CLAUDE.md`'s
Status section).

To also try the Astro integration once the CMS is running: `cd examples/astro-site && cp
.env.example .env && pnpm dev` — see [`docs/ASTRO.md`](docs/ASTRO.md).

## Package manager

This repo uses **pnpm** exclusively. Do not use npm or yarn.

## License

MIT — see [LICENSE](LICENSE).
