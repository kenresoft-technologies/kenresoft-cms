# Contributing to Kenresoft CMS

Thanks for considering a contribution. This document covers the mechanics of contributing code;
for the architecture and design rationale behind the codebase, start with
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — it's the source of truth for design decisions,
the domain model, the API contract, and security rules.

## Before you start

- **Bug fixes and small improvements**: feel free to open a PR directly.
- **New features or anything that changes the architecture**: please open an issue first to
  discuss the approach before writing code. This project has a deliberately narrow scope (see
  `docs/ARCHITECTURE.md` §11 on single-site-per-deployment, and its Changelog section for
  examples of features that were explicitly deferred rather than built speculatively) — an
  up-front discussion saves you from building something that doesn't fit.
- **Security vulnerabilities**: do not open a public issue or PR. See [`SECURITY.md`](SECURITY.md).

## Project layout

This is a pnpm workspace monorepo:

- `apps/api/` — the Cloudflare Worker (Hono, D1, R2)
- `apps/admin/` — the React admin SPA
- `packages/database/` — Drizzle schema, migrations, seed data
- `packages/contracts/` — shared Zod schemas (the API contract)
- `packages/types/` — shared TypeScript types
- `packages/config/` — shared ESLint/TS/Prettier config
- `packages/plugin-sdk/`, `packages/plugin-*` — the plugin platform and its plugins
  (see [`docs/PLUGINS.md`](docs/PLUGINS.md))
- `integrations/astro/` — the `@kenresoft-cms/astro` client package
- `examples/astro-site/` — a reference frontend consuming the public API

## Package manager

**This repo uses `pnpm` exclusively** — never `npm` or `yarn`. See the root `README.md`'s
"Package manager" section for why the recommended install command still starts with
`npm create`.

## Getting set up locally

```bash
git clone https://github.com/kenresoft-technologies/kenresoft-cms.git
cd kenresoft-cms
pnpm install
```

For running the API/admin locally against your own dev D1/R2, see each app's own README
(`apps/api/README.md`, `apps/admin/README.md`) and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Never point development or tests at a shared/production deployment.

## Before opening a PR

Run the full validation suite locally — the same checks CI runs:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- Every schema change goes through a Drizzle migration (`packages/database`) — never hand-edit
  the D1 schema without one.
- If you're touching `packages/contracts`, remember both `apps/api` and `apps/admin` consume it —
  check both compile.
- Keep PRs focused. A bug fix doesn't need an unrelated refactor riding along with it.

## Commit and PR conventions

- Prefer small, reviewable commits with clear messages describing *why*, not just *what*.
- Never commit directly to `main` — it's production. Work against `develop` or a
  `feature/*`/`fix/*` branch and open a PR.
- Reference the issue your PR addresses, if there is one.

## Code style

Formatting and linting are enforced by the shared config in `packages/config` and checked in CI
(`pnpm lint`). There's no separate style guide beyond what the linter enforces plus the general
principles in this repo's own `CLAUDE.md` (no speculative abstraction, no dead code paths, minimal
comments — explain *why*, not *what*).

## License

By contributing, you agree that your contributions will be licensed under this project's
[MIT license](LICENSE).
