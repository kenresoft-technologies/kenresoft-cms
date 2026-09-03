# @kenresoft-cms/admin — Admin Worker

The Kenresoft CMS admin dashboard: a React + Vite single-page application, deployed as its own
Cloudflare Worker serving **static assets only** — no server-side code, no API logic, no
database access. This README documents it as its own deployable component. For the full system
(API + Admin) in one command, see the [root README](../../README.md) and
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) — most people should start there instead of here.

## 1. What this component is

A single-page dashboard for managing content types, entries, media, forms, users, and settings.
Built with React 19, Vite, TanStack Query/Table, Tiptap, and shadcn/ui. The production build is a
static bundle (`dist/`) served by Cloudflare's **Workers Static Assets** feature
(`apps/admin/wrangler.toml`) — not Cloudflare Pages, and not a Worker with its own request
handler.

## 2. Its relationship to the API Worker

The Admin Worker and the [API Worker](../api/README.md) are **two independent Cloudflare
Workers**, deployed and versioned separately, on purpose. The admin app never talks to D1/R2, and
never runs any server-side logic of its own — every piece of data it shows or writes goes over a
plain, browser-side `fetch()` call to the API Worker's public HTTPS URL
(`src/lib/api-client.ts`, `src/lib/auth-client.ts`), using an explicit CORS allow-list and
`SameSite=None; Secure` cookies on the API side to make that cross-origin session work. There is
**no Service Binding, no server-side proxy, and no shared runtime** between the two — this is
deliberate: it keeps the admin's own deploy/rollback lifecycle fully independent of the API's,
and it's not something this component should ever grow past being.

## 3. Prerequisites

- The [API Worker](../api/README.md) deployed (or running locally) first — this app has nothing
  to talk to otherwise.
- `pnpm` and Node 20+. Inside this monorepo, `pnpm install` at the **repo root** is the normal
  path. This directory can also be installed **standalone** (copied out on its own, no sibling
  workspace packages) — see "Deployment" below for what that depends on.

## 4. Local development

From the repo root:

```bash
pnpm install
cp apps/admin/.env.example apps/admin/.env
pnpm --filter @kenresoft-cms/admin dev   # or `pnpm dev` at the root to also start the API
```

Runs on `http://localhost:5173` via Vite, pointed at `VITE_API_URL` from `.env` (defaults to the
local API on `:8787`). `pnpm dev:live` (a separate Vite mode, its own `.env.live`) runs the same
app locally against a **remote**, already-deployed API instead — useful for managing a real
deployment's content without redeploying the admin app itself.

## 5. Build process

```bash
VITE_API_URL=https://your-api-worker-url.workers.dev pnpm --filter @kenresoft-cms/admin build
```

Runs `vite build` (output: `dist/`) and then `scripts/generate-headers.mjs`, which writes
`dist/_headers` — see "Workers Static Assets configuration" below for why that's a separate,
generated step rather than a static file.

## 6. `VITE_API_URL`

This is the single most important build-time value for this component. Vite inlines it into the
JS bundle at build time — it is **not** runtime-configurable, and there is no way to change which
API a deployed build talks to without rebuilding and redeploying. It must point at your **already
deployed** API Worker's real URL, which means:

- You cannot build the admin app before the API Worker has been deployed at least once (a Worker
  has no `*.workers.dev` URL until it exists).
- If you redeploy the API Worker under a different name/URL later, the admin app needs a rebuild.

`pnpm run setup` (root) handles this ordering for you automatically. Building manually, you
provide it yourself as shown above.

## 7. Deployment

**This directory is now installable standalone** (copied out on its own, with no sibling
workspace packages present) — this was a real, investigated limitation until recently, fixed by
removing every `workspace:*` dependency this app had:

- Cloudflare's deploy-button docs state that pointing the button at a **subdirectory** of a repo
  makes Cloudflare treat that subdirectory as the *entire* contents of the new repository it
  creates — "your application must be fully isolated within that subdirectory, including any
  dependencies." This app used to fail that requirement two different ways.
- It had a real (not just type-only) runtime dependency on a sibling workspace package,
  `@kenresoft-cms/contracts` (`ROLE_RANK`, `roleAtLeast`, and several enum arrays are bundled into
  the actual production JS, not erased at build) — fixed by **publishing it to npm**
  (`@kenresoft-cms/contracts`, MIT-licensed, source lives at `packages/contracts` in this repo) and
  depending on it by a real semver range instead of `workspace:*`. Inside this monorepo, pnpm
  still links the local workspace copy for day-to-day development (`link-workspace-packages=true`
  in the root `.npmrc`) — the published package only matters once this directory leaves the
  monorepo.
- It also depended on `@kenresoft-cms/config` (shared ESLint rules, dev-only) and reached outside
  its own directory for `tsconfig.json`'s `extends`. Neither carries runtime logic worth
  publishing, so both were **inlined directly into this directory** instead (`eslint.config.js`,
  `tsconfig.json`, `tsconfig.node.json`) — if the monorepo's shared lint/TS config changes, mirror
  the change here too; there's no automatic sync.
- Confirmed empirically, not just reasoned about, against the *real* published npm package (not a
  simulation): copying this directory alone into an isolated directory with none of its former
  siblings present, then running `pnpm install && VITE_API_URL=... pnpm build && wrangler deploy
  --dry-run` — all three succeeded with no errors, reproducing exactly the isolation Cloudflare's
  own docs describe for a subdirectory button URL.
- **Not yet verified**: an actual live "Deploy to Cloudflare" button click-through against
  Cloudflare's own UI for a subdirectory URL pointing at this directory. The dependency-resolution
  blocker that made this categorically impossible is fixed and verified as above; the button's own
  wizard flow (subdirectory URL syntax, environment-variable prompts for `VITE_API_URL`) has not
  been clicked through for real the way the [API Worker's button](../api/README.md) has.

Below is an **unverified draft** of what that button URL should be, going by the subdirectory URL
format Cloudflare's own `create-cloudflare` tool documents (`github.com/<owner>/<repo>/tree/
<branch>/<path>`) — not a confirmed fact for *this specific* button service, since Cloudflare's own
deploy-button docs don't spell out the subdirectory query format explicitly. Click it once to find
out for real; update this note either way once someone has:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kenresoft-technologies/kenresoft-cms/tree/develop/apps/admin)

**What actually works today:**

```bash
pnpm install
pnpm run setup        # from the repo root — provisions + deploys both Workers, recommended
```

or, once the API is deployed, just this component:

```bash
cd apps/admin
VITE_API_URL=https://your-api-worker-url.workers.dev pnpm build
wrangler deploy
```

The first deploy also auto-provisions the Worker itself (its name comes from
`apps/admin/wrangler.toml` — no separate project-creation step, unlike Cloudflare Pages). Then
add the resulting `https://your-admin.<subdomain>.workers.dev` origin to the **root**
`wrangler.toml`'s `CORS_ORIGINS` and redeploy the API — without this, sign-in fails, since the API
rejects cross-origin cookie auth from an origin it doesn't recognize.

**CI/CD**: `.github/workflows/deploy.yml`'s `deploy-admin` job runs the same build+deploy above,
gated behind `DEPLOY_ENABLED` like every other deploy job.

## 8. SPA routing / deep-link behavior

`apps/admin/wrangler.toml` sets `not_found_handling = "single-page-application"` — any request
path that doesn't match a real built file (every React Router route, e.g. `/entries/123`) gets
served `index.html` with a `200`, letting the client-side router take over. Verified directly: a
deployed Worker serves `index.html` correctly for a deep link, not a 404.

## 9. Workers Static Assets configuration

`apps/admin/wrangler.toml` is deliberately minimal — `[assets] directory = "./dist"` plus the
`not_found_handling` above, nothing else. No `main` script, no bindings: this Worker runs zero
application code, by design (see "Its relationship to the API Worker" above).

Security headers are the one thing static assets don't get "for free" the way the API Worker's
own middleware gives it — Cloudflare only applies its own defaults (`Content-Type`,
`Cache-Control`, `ETag`) to asset responses, not this app's `Content-Security-Policy` or similar.
`scripts/generate-headers.mjs` writes `dist/_headers` (the same convention Cloudflare Pages
uses) after every build, setting:

- `Content-Security-Policy` — `default-src 'self'`, a `sha256-` hash (not `'unsafe-inline'`) for
  the one inline script `index.html` ships (dark-mode detection, computed from the real built
  output so it can never silently drift), `'unsafe-inline'` for `style-src` only (Radix UI and
  cmdk apply computed inline `style` attributes at runtime for popover/dialog positioning — a
  different value every render, so no static hash or nonce can cover it), and `img-src`/
  `connect-src` scoped to `'self'` plus the exact `VITE_API_URL` this build was made with.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security`,
  `X-Frame-Options: DENY` — matching the API Worker's own set, minus its CSP (which is
  `default-src 'none'`, correct for JSON responses but would blank this entire application).

This exact policy was verified against the real, running application, not assumed: a
`Content-Security-Policy-Report-Only` header was served against a real local build, driven with a
real browser through sign-up, the user-menu dropdown, the command palette, a content-type dialog,
and the media-upload dialog — zero violations, zero console errors — then re-verified in enforce
mode with the same walkthrough, then confirmed live on a real (throwaway) Cloudflare deployment
via `curl -I` that every header above is actually served at the edge.

Generating this file at build time (rather than a static, checked-in one) is deliberate:
`VITE_API_URL` differs per deployment and is already required for the Vite build itself, so this
keeps the CSP and the app bundle from ever silently drifting apart.

## 10. Authentication expectations

This app has no authentication logic of its own — it calls the API Worker's better-auth routes
(`src/lib/auth-client.ts`) and reads the resulting session cookie exactly like any other browser
client would. It expects: the API's `CORS_ORIGINS` to include this Worker's real deployed origin
(see "Deployment" above), and the API's cookies to be `SameSite=None; Secure` (already the API's
unconditional default, precisely because this cross-origin relationship is how the two Workers
are meant to talk).
