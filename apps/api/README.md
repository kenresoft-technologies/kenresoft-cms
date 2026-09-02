# @kenresoft-cms/api — API Worker

The Kenresoft CMS API Worker: a Hono application on Cloudflare Workers backed by D1 (content,
users, sessions) and R2 (media files), with authentication via better-auth. This is the only
part of the system that touches the database directly — the [Admin Worker](../admin/README.md)
and any other frontend (see the [Astro Integration](../../integrations/astro/README.md)) talk to
it exclusively over its public REST API.

This README documents the API Worker as its own deployable component. For the full system
(API + Admin) in one command, see the [root README](../../README.md) and
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) — most people should start there instead of here.

## 1. What this component provides

- Content types, fields, and entries (draft/publish, scheduled publishing, revision history).
- Forms and public form submissions (rate limited, spam-filtered).
- A media library backed by R2 (upload, metadata, public/admin file serving).
- Authentication and role-based authorization (owner/admin/editor/author/viewer) via better-auth.
- A public, unauthenticated REST API for any frontend to consume, and an authenticated admin API
  the [Admin Worker](../admin/README.md) is built against.
- An OpenAPI document and a Scalar reference UI at `/api/v1/docs`.

Full design/domain-model reference: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## 2. Prerequisites

- A Cloudflare account (the free tier covers Workers, D1, and R2 at this project's scale).
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) installed and logged in
  (`wrangler login`).
- `pnpm` (`corepack enable`) and Node 20+.
- This is a pnpm workspace package — `pnpm install` at the **repo root** first; it won't install
  standalone (see "Deployment" below for why that also affects the deploy button).

## 3. Required Cloudflare resources

- **A D1 database**, bound as `DB`.
- **An R2 bucket**, bound as `MEDIA_BUCKET`.
- Three **Workers Rate Limiting** bindings (form submissions, auth routes, password-recovery
  routes) — these use arbitrary `namespace_id` values, not provisioned resources, so they need no
  setup step of their own.
- A **Cron Trigger** (`*/5 * * * *`) for scheduled publishing.

All of this is declared in the **repository root's** `wrangler.toml` (not a file inside this
directory — see that file's own top comment for why: the "Deploy to Cloudflare" button only
detects a config at the repo root). `database_id`/`bucket_name` are deliberately omitted there,
which triggers wrangler's own automatic provisioning on first deploy — see
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for the full walkthrough, including the explicit
`wrangler d1 create`/`r2 bucket create` alternative if you want more control.

## 4. Local development

From the repo root:

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in BETTER_AUTH_SECRET
pnpm --filter @kenresoft-cms/database migrate:local
pnpm --filter @kenresoft-cms/api dev   # or `pnpm dev` at the root to also start the admin
```

Runs on `http://localhost:8787` via `wrangler dev` against a local D1/R2 simulation — no real
Cloudflare resources touched. `.dev.vars` (gitignored) overrides `wrangler.toml`'s committed
`[vars]` and holds your local `BETTER_AUTH_SECRET`.

## 5. Database and migrations

Schema and migrations live in the sibling `@kenresoft-cms/database` package (Drizzle ORM), not here:

```bash
pnpm --filter @kenresoft-cms/database migrate:local    # local D1 (dev)
pnpm --filter @kenresoft-cms/database migrate:remote    # your deployed D1
```

Every schema change goes through a Drizzle migration — never edit the D1 schema without one.
`wrangler d1 migrations apply` records applied migrations remotely, so re-running is always safe
(it only applies what's missing).

## 6. Environment variables and secrets

Plain `[vars]` in `wrangler.toml` (safe to commit, no real secrets): `API_VERSION`,
`CORS_ORIGINS`, `BETTER_AUTH_URL`, and optional email/recovery configuration — see the file's own
comments for each. Real secrets, set via `wrangler secret put <NAME>` (never committed):

| Secret | Required? | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Yes | Session/token signing. Deploying without it leaves better-auth using an insecure default and erroring at request time. |
| `RESEND_API_KEY` | Only if `EMAIL_PROVIDER = "resend"` | Password-reset email delivery. |
| `OWNER_RECOVERY_SECRET` | Optional, opt-in | Enables the break-glass `POST /api/v1/system/recover-owner` route — absent by default, and the route 404s until you set it. Treat it as a standing master key; see `docs/DEPLOYMENT.md`'s recovery section. |

## 7. Authentication (better-auth)

better-auth is mounted under `/api/v1/auth/*` (not its default `/api/auth`, to stay under the
versioned API prefix — see `apps/api/src/lib/auth-options.ts`). The first account ever created
becomes the deployment's **owner**; everyone after defaults to **editor**
(`docs/ARCHITECTURE.md` §10 has the full owner/admin/editor/author/viewer model). Cookies are set
with `SameSite=None; Secure` unconditionally — deliberate, not a bug: the Admin Worker is a
*different origin* from this API by design (see the Admin README), so session cookies need to
survive a genuinely cross-origin request.

## 8. CORS configuration

`CORS_ORIGINS` (`wrangler.toml`'s `[vars]`) is an explicit, comma-separated allow-list —
never `*` (`apps/api/src/middleware/cors.ts`). Add every origin that needs credentialed
cross-origin requests here, most importantly your deployed Admin Worker's URL. `pnpm run setup`
(root) and `scripts/setup.mjs` wire this in for you automatically, idempotently — running setup
again never duplicates an origin already present.

## 9. API URL structure

Every route lives under `/api/v1/*`:

- `/api/v1/public/*` — unauthenticated, for any frontend (content, media files, form
  submissions).
- `/api/v1/admin/*` — session-authenticated, used by the Admin Worker.
- `/api/v1/auth/*` — better-auth's own routes.
- `/api/v1/system/*` — the break-glass owner-recovery route (404 unless opted in).
- `/api/v1/openapi.json` / `/api/v1/docs` — the generated OpenAPI document and its Scalar UI.

## 10. Deployment

Three ways, same as the whole CMS — full detail in
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md):

**One-click** — this is the one component a Cloudflare "Deploy to Cloudflare" button genuinely
works for, verified with a real click-through against this exact repository:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kenresoft-technologies/kenresoft-cms)

**Why this one works and a subdirectory-scoped button wouldn't**: this button URL points at the
**full repository**, not a subdirectory — deliberately, and load-bearing. Cloudflare's own docs
state that a subdirectory button URL isolates that directory as the *entire* contents of the new
repo it creates ("your application must be fully isolated within that subdirectory, including any
dependencies"). This is a pnpm workspace monorepo — `apps/api` depends on two sibling workspace
packages (`@kenresoft-cms/database`, `@kenresoft-cms/contracts`) that wouldn't exist in an isolated
`apps/api`-only checkout, so a subdirectory URL would fail at `pnpm install` before any build
step ran. Pointing the button at the full repo instead sidesteps this entirely — the whole
workspace comes along, and `wrangler.toml` living at the **repository root** (not inside this
directory) is what lets Cloudflare's config auto-detection find it. This only deploys the API —
Cloudflare's button mechanism deploys exactly one Worker per click, so completing the CMS still
needs `pnpm run setup` or the manual admin steps afterward.

**Guided CLI / manual** — from the repo root:

```bash
pnpm install
pnpm run setup        # provisions + deploys both Workers, recommended
```

or, for just this component:

```bash
pnpm --filter @kenresoft-cms/api deploy
pnpm --filter @kenresoft-cms/database migrate:remote
```

The first plain `wrangler deploy` auto-provisions D1/R2 if `wrangler.toml` doesn't already have
their real ids. `docs/DEPLOYMENT.md` steps 1–6 cover the full manual sequence, including the
`BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` two-deploy dance a fresh Worker needs.

**CI/CD**: `.github/workflows/deploy.yml`'s `deploy-api` job runs the same two commands above,
gated behind a `DEPLOY_ENABLED` repository variable so forking this repo never risks an
accidental deploy — see `docs/DEPLOYMENT.md`'s GitHub Actions section for the secrets/variables
it needs.
