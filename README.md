# Kenresoft CMS

A reusable, Cloudflare-native, API-first content management platform. First production
implementation: the Pathvera Group website.

Content lives in Cloudflare D1, media lives in Cloudflare R2, the API runs on Cloudflare
Workers (Hono), and the admin application talks only to the API — never to the database
directly.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture and technical
specification (source of truth for design decisions).

## Status

Phase 0 — repository scaffold and domain model. No application code yet.

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
docs/       Architecture and reference documentation
examples/   Example integrations (e.g. Astro consumer site)
tests/      Cross-package integration/E2E tests
```

## Getting started

```bash
pnpm install
pnpm build
```

Each app's dev server is run independently (`apps/api`: `wrangler dev`; `apps/admin`: `vite`).

## Package manager

This repo uses **pnpm** exclusively. Do not use npm or yarn.

## License

MIT — see [LICENSE](LICENSE).
