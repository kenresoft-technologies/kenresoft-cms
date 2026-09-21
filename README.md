# Kenresoft CMS

> **Official documentation: https://docs.kenresoft.com**
> Getting started, deployment, the CLI, Astro integration, plugins, and troubleshooting. This
> README keeps only the quick start.

A reusable, Cloudflare-native, API-first content management platform. Content lives in
Cloudflare D1, media lives in Cloudflare R2, the API runs on Cloudflare Workers (Hono), and the
admin dashboard talks to that API over plain HTTPS, never to the database directly.

Self-hosted, not a hosted service: deploying it means provisioning resources in **your own**
Cloudflare account. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture
and technical specification (the source of truth for design decisions).

Where to find things:

1. **Install it**: the quick start below, or [Installation](https://docs.kenresoft.com/cms/getting-started/installation/).
2. **Developer docs**: [Developer guide](https://docs.kenresoft.com/cms/developer/) and [Astro](https://docs.kenresoft.com/cms/astro/).
3. **API reference**: every deployment serves it itself at `/api/v1/docs` (interactive Scalar UI)
   and `/api/v1/openapi.json` (machine-readable spec). The [public API guide](https://docs.kenresoft.com/cms/developer/public-api/)
   explains how to use them.

## What you get

1. **Content**: content types with typed fields, entries with draft/publish, scheduled publishing,
   revision history and restore, live preview, and bulk export/import per content type.
2. **Site building**: pages composed from blocks, reusable blocks, templates, dynamic routing, and
   structured site settings (contact, social, navigation, footer, SEO).
3. **Media and forms**: an R2 media library with byte-verified image uploads, and forms with
   spam/rate-limited public submissions, an inbox, email notifications and in-CMS replies.
4. **Access and security**: Owner/Admin/Editor/Author/Viewer roles, email-verified staff accounts,
   two-factor authentication, password recovery, session monitoring, and an audit log.
5. **Integration**: a documented public REST API (OpenAPI + Scalar), webhooks with signed
   deliveries, Astro client and starter, and a plugin platform (with a Commerce plugin: catalog,
   cart, customer accounts, checkout, orders and Paystack payments, with a storefront client in
   `@kenresoft-cms/astro`).

## Recommended: Complete CMS Installation

```bash
npm create @kenresoft-cms@latest your-site-name
cd your-site-name
pnpm install
pnpm run setup
```

(Equivalent to `git clone https://github.com/kenresoft-technologies/kenresoft-cms.git
your-site-name`, same files, no GitHub URL to remember.)

`npm create` here is only the bootstrap mechanism, it's the standard, zero-install way any npm
user can fetch and scaffold a new project (`npm create <pkg>` is npm's built-in convention, akin
to `npm init`), not a statement that this repo uses npm. The scaffolded project itself, and every
command after that first line, uses **pnpm**, see "Package manager" below.

One command provisions and deploys the whole system into your own Cloudflare account:

- **API Worker** (`apps/api`) and **Admin Worker** (`apps/admin`): deployed
- **D1** database and **R2** bucket: created if you don't already have them
- **Database migrations**: applied
- **Better Auth**: a real session secret generated and set
- **CORS**: the Admin Worker's real origin wired into the API's allow-list automatically

This is the path for anyone who wants the complete Kenresoft CMS running with the least effort.
Full details, plus a guided-CLI-vs-manual-vs-CI comparison: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Once it finishes, it prints both Worker URLs. Open the admin one and sign up. The first account
created becomes the deployment's **owner** (`docs/ARCHITECTURE.md` §10 has the full role model).

## Updating and maintaining a deployment

1. **Update to the latest CMS**: `pnpm run update`. It pulls the latest code, applies new
   database migrations, and redeploys both Workers. It never touches your secrets or config, and
   never modifies a separate Astro website.
2. **Change configuration**: `pnpm run update -- --auth`, `--email`, `--storage` or `--database`
   (one at a time). Re-running `pnpm run setup` is also safe: it keeps existing values.
3. **Rename a Worker** (its `*.workers.dev` URL): `pnpm run rename-worker`.
4. **Back up media**: `pnpm --filter @kenresoft-cms/api backup-media` (D1 has its own free
   30-day Time Travel; R2 has no built-in equivalent).

Details for all of these: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Local development

```bash
pnpm install
cp .dev.vars.example .dev.vars           # fill in BETTER_AUTH_SECRET
cp apps/admin/.env.example apps/admin/.env
pnpm --filter @kenresoft-cms/database migrate:local
pnpm dev
```

`pnpm dev` starts every app in parallel, API on `http://localhost:8787` (`wrangler dev`), admin
on `http://localhost:5173` (Vite). Each also runs independently:
`pnpm --filter @kenresoft-cms/api dev` / `pnpm --filter @kenresoft-cms/admin dev`.

## Already have a Kenresoft CMS deployment? Scaffold just an Astro frontend

If you (or someone else) already deployed the CMS above and you just need a frontend that reads
from it, you don't need the complete installation or this monorepo at all:

```bash
npm create @kenresoft-cms@latest my-site -- --astro
cd my-site
cp .env.example .env   # set PUBLIC_KENRESOFT_CMS_URL to your deployed API Worker's URL
pnpm install
pnpm dev
```

A small, standalone Astro project with [`@kenresoft-cms/astro`](integrations/astro/README.md)
(published on npm, no workspace linking, no monorepo) already wired up: one example content
page, a form example, and comments pointing at exactly what to change for your own content
types. See [`docs/ASTRO.md`](docs/ASTRO.md#connecting-your-own-separately-hosted-astro-project)
for the full walkthrough, or `packages/create/templates/astro-starter` for what it scaffolds.

### Already have an Astro site? Connect it, and keep it updated

Three separate things get updated, on three separate schedules. None of them touches another.

1. **The CMS** (API, admin, database migrations): `pnpm run update`, run inside your CMS
   repository. It never modifies any Astro website.
2. **The Kenresoft integration in your Astro site** (the few files Kenresoft generated for you):
   `npx @kenresoft-cms/create astro --update`, run inside your Astro project. It never modifies
   the CMS.
3. **The `@kenresoft-cms/astro` package** in your Astro site. The `--update` command above also
   moves this to the newest compatible version. It looks the version up on npm explicitly instead
   of relying on a caret range, because while packages are `0.x`, `^0.3.0` will not reach `0.4.0`.

**Connect an existing Astro project** (run from its root):

```bash
npx @kenresoft-cms/create astro --cms-url https://your-cms-api.example.com
```

1. It checks this is an Astro project (Astro 5 or newer) and reads your Astro version.
2. It installs `@kenresoft-cms/astro` if missing (or upgrades a version too old to work).
3. It adds the same-origin `/cms/*` proxy, so the session cookie stays first-party to your site.
4. It adds `PUBLIC_KENRESOFT_CMS_URL` to `.env` and `.env.example`, only if not already set.
5. It prints what it created, changed, skipped, and what you still need to do by hand.

Running it again is safe: it changes nothing that is already in place.

**Files Kenresoft owns** (marked `@kenresoft-managed`, tracked in `.kenresoft/integration.json`):

- `src/pages/cms/[...path].ts`, the proxy
- `src/lib/kenresoft.ts`, the client helpers (`cms`, `cmsForRequest`, `browserCms`)
- `.kenresoft/integration.json`, the record of what it wrote

Everything else (pages, layouts, components, styles, `astro.config`, wrangler config, your own
`.env` values) is yours and is never overwritten. If a file already sits at a managed path and
isn't byte-identical to what Kenresoft would write, it is reported as a **conflict** and left
alone (exit code 2). Re-run with `--force` to replace it deliberately. Things it can't safely edit
for you (an adapter, the `global_fetch_strictly_public` Workers flag, `TRUSTED_PROXY_SECRET`, your
CMS's `CORS_ORIGINS`) are listed under "Needs manual action".

**Update later:**

```bash
npx @kenresoft-cms/create astro --update
```

It refreshes the package and any managed file you haven't edited, and reports conflicts for the
ones you have. `--no-install` edits `package.json` only, if you want to run the install yourself.

## Advanced: Individual Components

The complete installation above is two independent Cloudflare Workers under the hood, deployed
and versioned separately on purpose (see
[`docs/DEPLOYMENT.md`'s "Two Workers, one install"](docs/DEPLOYMENT.md#two-workers-one-install)).
If you only need one piece, or want to understand exactly what `pnpm run setup` does before
running it, each has its own README with prerequisites, configuration, and a deploy path:

- **[API Worker](apps/api/README.md)**: Hono + D1 + R2 + Better Auth + REST API. Has a real,
  working one-click "Deploy to Cloudflare" button.
- **[Admin Worker](apps/admin/README.md)**: the React/Vite CMS dashboard, deployed as Workers
  Static Assets. Installable and deployable standalone (its own npm-published dependencies, no
  workspace packages required). See that README for what's verified vs. not yet.
- **[Astro Integration](integrations/astro/README.md)**: a typed client for reading CMS content
  from an Astro (or any JS/TS) site, published on npm as `@kenresoft-cms/astro`. Not a deployable
  Worker, a library your own site depends on. To build your own frontend, use the section above
  (`npm create @kenresoft-cms@latest my-site -- --astro`), [`examples/astro-site`](examples/astro-site)
  is a separate, illustrative reference implementation, not a starter to fork or deploy.

## Monorepo layout

```
wrangler.toml   The API Worker's config  lives at the repo root, not apps/api/, so the
                "Deploy to Cloudflare" button (which only looks there) can find it
apps/
  api/      @kenresoft-cms/api     API Worker (Hono + D1 + R2 + Better Auth)
  admin/    @kenresoft-cms/admin   Admin Worker (React + Vite, Workers Static Assets)
packages/
  database/   @kenresoft-cms/database    Drizzle schema, migrations, seed data
  contracts/  @kenresoft-cms/contracts   Shared Zod schemas + API contract, used by api/admin/SDK
  types/      @kenresoft-cms/types       Shared TypeScript types
  config/     @kenresoft-cms/config      Shared ESLint/TS/Prettier base config
  create/     @kenresoft-cms/create      `npm create @kenresoft-cms@latest` scaffolding tool, the
                                         Astro starter, and `create astro` for existing sites
  plugin-sdk/       @kenresoft-cms/plugin-sdk        Contract every plugin builds against
  plugin-ecommerce/ @kenresoft-cms/plugin-ecommerce  Commerce plugin (catalog, cart, checkout, payments)
  plugin-hello/     @kenresoft-cms/plugin-hello      Minimal reference plugin
scripts/    `pnpm run setup` / `update` / `rename-worker`, and their shared helpers
integrations/
  astro/      @kenresoft-cms/astro       Astro Integration: typed client for the public API
docs/       ARCHITECTURE, DEPLOYMENT, ASTRO, PLUGINS and SITE_BUILDER reference documentation
examples/
  astro-site/ Illustrative reference implementation (not a starter  see its own README)
tests/      Empty, reserved scaffolding  real full-stack E2E lives in apps/admin/e2e instead
            (Playwright, drives the Admin Worker + API Worker together against a dedicated
            port/D1 state)
```

## Status

The core platform and everything listed under "What you get" is built and in use. In roadmap
terms (`docs/ARCHITECTURE.md` §20): the Worker/D1 foundation, content model, admin and roles,
draft/publish and revisions, media, the public and admin REST API, and forms are done, followed by
the site builder (pages, blocks, templates, routing, drag-and-drop editing), webhooks, two-factor
auth, account recovery, the plugin platform, and the Commerce plugin end to end, including its Astro storefront.

Not done yet, so you do not assume otherwise:

1. Plugin-contributed block types and block patterns/presets for the site builder.
2. Multi-language content, and a public content-type metadata endpoint (a deliberate
   open product decision, see `docs/ASTRO.md`).

`examples/astro-site` is an illustrative reference, not a starter to fork. To build your own
frontend, scaffold one with `npm create @kenresoft-cms@latest my-site -- --astro`, or connect an
existing Astro project as described above.

For the detailed, continuously-updated record of what shipped and how it was verified, see the
**Status** section of [`CLAUDE.md`](CLAUDE.md) and [`CHANGELOG.md`](CHANGELOG.md).

## Package manager

This repo uses **pnpm** exclusively. Do not use npm or yarn. The only exception is
`npm create @kenresoft-cms@latest` above, which only bootstraps a new project directory (see that
section); everything inside the resulting project, including its own dependency installs, still
goes through pnpm.

## License

MIT. See [LICENSE](LICENSE).
