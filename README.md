# Kenresoft CMS

A reusable, Cloudflare-native, API-first content management platform. Content lives in
Cloudflare D1, media lives in Cloudflare R2, the API runs on Cloudflare Workers (Hono), and the
admin dashboard talks to that API over plain HTTPS — never to the database directly.

Self-hosted, not a hosted service: deploying it means provisioning resources in **your own**
Cloudflare account. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture
and technical specification (the source of truth for design decisions).

## Recommended: Complete CMS Installation

```bash
npm create @kenresoft-cms@latest your-site-name
cd your-site-name
pnpm install
pnpm run setup
```

(Equivalent to `git clone https://github.com/kenresoft-technologies/kenresoft-cms.git
your-site-name` — same files, no GitHub URL to remember.)

One command, provisions and deploys the whole system into your own Cloudflare account:

- **API Worker** (`apps/api`) and **Admin Worker** (`apps/admin`) — deployed
- **D1** database and **R2** bucket — created if you don't already have them
- **Database migrations** — applied
- **Better Auth** — a real session secret generated and set
- **CORS** — the Admin Worker's real origin wired into the API's allow-list automatically

This is the path for anyone who wants the complete Kenresoft CMS running with the least effort.
Full details, plus a guided-CLI-vs-manual-vs-CI comparison: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Once it finishes, it prints both Worker URLs — open the admin one and sign up. The first account
created becomes the deployment's **owner** (`docs/ARCHITECTURE.md` §10 has the full role model).

## Local development

```bash
pnpm install
cp .dev.vars.example .dev.vars           # fill in BETTER_AUTH_SECRET
cp apps/admin/.env.example apps/admin/.env
pnpm --filter @kenresoft-cms/database migrate:local
pnpm dev
```

`pnpm dev` starts every app in parallel — API on `http://localhost:8787` (`wrangler dev`), admin
on `http://localhost:5173` (Vite). Each also runs independently:
`pnpm --filter @kenresoft-cms/api dev` / `pnpm --filter @kenresoft-cms/admin dev`.

## Advanced: Individual Components

The complete installation above is two independent Cloudflare Workers under the hood, deployed
and versioned separately on purpose (see
[`docs/DEPLOYMENT.md`'s "Two Workers, one install"](docs/DEPLOYMENT.md#two-workers-one-install)).
If you only need one piece — or want to understand exactly what `pnpm run setup` does before
running it — each has its own README with prerequisites, configuration, and a deploy path:

- **[API Worker](apps/api/README.md)** — Hono + D1 + R2 + Better Auth + REST API. Has a real,
  working one-click "Deploy to Cloudflare" button.
- **[Admin Worker](apps/admin/README.md)** — the React/Vite CMS dashboard, deployed as Workers
  Static Assets. Installable and deployable standalone (its own npm-published dependencies, no
  workspace packages required) — see that README for what's verified vs. not yet.
- **[Astro Integration](integrations/astro/README.md)** — a typed client for reading CMS content
  from an Astro (or any JS/TS) site. Not a deployable Worker — a library your own site depends
  on. See also [`examples/astro-site`](examples/astro-site) for a full reference site.

## Monorepo layout

```
wrangler.toml   The API Worker's config — lives at the repo root, not apps/api/, so the
                "Deploy to Cloudflare" button (which only looks there) can find it
apps/
  api/      @kenresoft-cms/api    — API Worker (Hono + D1 + R2 + Better Auth)
  admin/    @kenresoft-cms/admin  — Admin Worker (React + Vite, Workers Static Assets)
packages/
  database/   @kenresoft-cms/database   — Drizzle schema, migrations, seed data
  contracts/  @kenresoft-cms/contracts  — Shared Zod schemas + API contract, used by api/admin/SDK
  types/      @kenresoft-cms/types      — Shared TypeScript types
  config/     @kenresoft-cms/config     — Shared ESLint/TS/Prettier base config
  create/     @kenresoft-cms/create     — `npm create @kenresoft-cms@latest` scaffolding tool
integrations/
  astro/      @kenresoft-cms/astro      — Astro Integration: typed client for the public API
docs/       Architecture and reference documentation, including docs/ASTRO.md
examples/
  astro-site/ Reference Astro site built on the Astro Integration — see its own README
tests/      Empty, reserved scaffolding — real full-stack E2E lives in apps/admin/e2e instead
            (Playwright, drives the Admin Worker + API Worker together against a dedicated
            port/D1 state)
```

## Status

Phases 1–7 of the roadmap are done: Worker/Hono/D1/Drizzle foundation, the content-type/field/
entry domain model, admin auth with role-based authorization, draft/publish with scheduled
publishing and revisions, the R2 media library, the public + admin REST API (OpenAPI, edge
caching), and forms with spam/rate-limited public submissions. Several cross-cutting UI passes
on top of that took the Admin Worker from functional CRUD screens to a full admin experience —
dashboard, command palette, drag-to-reorder fields, a redesigned Settings area, dark mode, and
more. The Astro Integration is done and production-deployable (`docs/ASTRO.md`).

For the authoritative, continuously-updated account of what's done and what isn't, see the
**Status** section of [`CLAUDE.md`](CLAUDE.md). For the target end state, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §20 (Implementation Roadmap).

## Package manager

This repo uses **pnpm** exclusively. Do not use npm or yarn.

## License

MIT — see [LICENSE](LICENSE).
