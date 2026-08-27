# Astro Integration

**Status: Phase 1 (local integration) complete, 2026-08-27. Phase 2 (production deployment)
not started.** See `docs/ARCHITECTURE.md` §15 for how this fits the broader architecture, and
§20 (Implementation Roadmap) for where it sits in the project's phases.

## What Kenresoft CMS is

Kenresoft CMS is a **frontend-agnostic, API-first** content management platform. The CMS
(Worker + D1 + R2, `apps/api`) and its admin UI (`apps/admin`) are one deployable unit; anyone
consuming its content — a website, a mobile app, another service — talks to it exclusively
through the **public REST API** (`GET /api/v1/public/...`, unauthenticated, read-only,
published content only). Nothing about the CMS core assumes or requires Astro. That boundary
is deliberate and load-bearing: it's what lets the same CMS back a Next.js site, a Flutter app,
or an Astro site without any of them getting special access.

## Astro as a first-class integration

Astro is not required, but it *is* officially supported, in the sense that this repo ships and
maintains a typed client for it: `@kenresoft/astro` (`integrations/astro/`). Its entire purpose
is removing the need to hand-write `fetch()` calls and re-derive the public API's response
shape from scratch:

```ts
import { createKenresoftClient } from '@kenresoft/astro';

const cms = createKenresoftClient({ url: 'http://localhost:8787' });

const posts = await cms.entries.list({ contentType: 'blog-post' });
const post = await cms.entries.get({ contentType: 'blog-post', slug: 'hello-world' });
```

Despite the package name, nothing in `integrations/astro/src/index.ts` is Astro-specific —
it's a plain, isomorphic `fetch` wrapper. It's positioned as *the* Astro integration because
Astro is this project's first-class frontend target (`docs/ARCHITECTURE.md` §2/§15), not
because the code needs Astro to run. Other frameworks are expected to call the public API
directly rather than through this package, at least for now (see Future work below).

### Why not `@kenresoft/cms-sdk`, why not framework-generic?

An earlier draft of `docs/ARCHITECTURE.md` §15 sketched a hypothetical `@kenresoft/cms-sdk`.
This implementation uses `@kenresoft/astro` instead, matching Astro's own convention for
official integrations (`@astrojs/<name>`-style naming) and keeping the scope honest: this
package was built for, and tested against, one framework. A framework-generic SDK is future
work, not a rename of this package (see Future work).

### What the client covers today

- `entries.list({ contentType })` — every published entry for a content type, by slug.
- `entries.get({ contentType, slug })` — one published entry, or `null` if it doesn't exist
  *or* isn't published (the public API doesn't distinguish those two cases — see
  `docs/ARCHITECTURE.md` §6/§14 — and neither does this client).
- A `KenresoftApiError` thrown for any other non-2xx response, carrying the HTTP status.

There's deliberately no `contentTypes.list()`/`contentTypes.get()`. The public API has no
endpoint for content-type metadata (field definitions, etc.) — only `apps/admin`'s
authenticated admin API can see that. A content type is only ever addressed by its slug when
fetching entries, which the client already supports; there was nothing else to wrap.

## How Astro communicates with the CMS

```
Kenresoft CMS/API (wrangler dev, :8787)
        |
        |  GET /api/v1/public/:contentType
        |  GET /api/v1/public/:contentType/:slug
        v
@kenresoft/astro  (integrations/astro)
        |
        v
   Astro site  (examples/astro-site)
        |
        v
     Browser
```

Astro never touches D1 or R2 directly, never sees an admin session token, and never imports
anything from `apps/api`'s internals. The public API is the entire interface.

## Local development

Two terminals:

```bash
# Terminal 1 — the CMS
pnpm --filter @kenresoft/api dev        # http://localhost:8787

# Terminal 2 — the Astro example
pnpm --filter kenresoft-cms-example-astro dev   # http://localhost:4321
```

(Or `pnpm dev` at the repo root, which starts every workspace app's dev server in parallel,
including both of the above.)

Both `integrations/astro` and `examples/astro-site` are ordinary pnpm workspace members
(`pnpm-workspace.yaml` lists `integrations/*` and `examples/*` alongside `apps/*`/`packages/*`)
— a plain `pnpm install` at the repo root wires `@kenresoft/astro` into the example via a
workspace symlink, same as any other internal package. There is no separate install step and
no `--ignore-workspace` flag needed; an earlier version of this example was deliberately kept
outside the workspace to mimic an external consumer, but that made consuming
`@kenresoft/astro` from it awkward for no real benefit — a real SDK's own example app living in
the SDK's own monorepo is a completely standard pattern.

## Environment variables

`examples/astro-site/.env` (copy from `.env.example`):

```
PUBLIC_KENRESOFT_CMS_URL=http://localhost:8787
```

The `PUBLIC_` prefix is Astro's convention for env vars that are safe to ship to the browser —
appropriate here since this is just the CMS's public API base URL, not a secret. Nothing in
this integration ever needs a server-only secret: the public API requires no authentication at
all, by design (§8/§9). If you ever add server-only configuration to an Astro site consuming
Kenresoft CMS (e.g. a *different* URL for admin-authenticated build tooling), give it a
non-`PUBLIC_`-prefixed name so Astro keeps it out of the client bundle.

## Static vs SSR

`examples/astro-site` uses static output (`astro.config.mjs`: `output: 'static'`). Every page
fetches from the CMS **at build time**:

```
CMS content (published entries)
        ↓
   astro build
        ↓
 Generated static HTML
```

This means **content changes require a new `astro build`** to appear in the built site — there
is no incremental/on-demand revalidation yet. `astro dev`, by contrast, re-runs each page's
CMS fetch on every request, so changes appear immediately without a rebuild while iterating
locally; this was verified directly (publish a new entry → visible in `astro dev` immediately;
rebuild the static site → visible in `dist/`; the *previous* `dist/` build, taken before the
publish, correctly does **not** contain it).

Static output was chosen for this first milestone because it's the simplest reliable strategy
and matches `docs/ARCHITECTURE.md` §20.1's "Astro renders the post" framing of the first
vertical slice. SSR is not implemented, but nothing here forecloses it: `@kenresoft/astro`'s
client has no build-time-only assumptions (it's just `fetch`, callable from an Astro
`getStaticPaths()` or equally from an Astro SSR endpoint/on-demand page), so switching
`examples/astro-site` to `output: 'server'` later — or adding webhook-triggered rebuilds — is a
config change in that example, not a redesign of the CMS API or the client.

## Cloudflare compatibility (future)

The eventual production shape (`docs/ARCHITECTURE.md` §15):

```
CLIENT CLOUDFLARE ACCOUNT
├── Kenresoft CMS
│   ├── Worker/API
│   ├── D1
│   └── R2
└── Astro Website
    └── Cloudflare deployment (Astro's official Cloudflare adapter)
```

The CMS and an Astro site consuming it are separate deployable applications, each with their
own Cloudflare deployment. **This phase does not implement or test that** — `apps/api`'s
`wrangler.toml` still has placeholder D1/KV resource IDs (see the `TODO(Phase 1)` comment at
its top), meaning no real Cloudflare resources have been provisioned for the CMS itself yet,
let alone a production Astro deployment alongside it. Getting there is genuinely a distinct
next phase, not a small extension of this one.

## Known limitations

- **No public media endpoint.** The only route that serves an R2-backed media file's bytes is
  `GET /api/v1/admin/media/:id/file`, which sits behind admin authentication
  (`docs/ARCHITECTURE.md` §14 doesn't yet specify a public one either). A `media`-type field on
  a content type has no way to be resolved to a fetchable URL from the public API today, so
  `examples/astro-site` does not render a featured image, and no Astro site can until this gap
  is closed.
- **No public content-type metadata endpoint.** By design, per above — but it does mean a
  generic Astro page can't discover a content type's field list at build/request time; it has
  to know the field names it expects in advance (as `examples/astro-site`'s pages do).
- **Static output means content edits need a rebuild.** See Static vs SSR above.
- A rare, non-deterministic `astro build` exit-code flake was observed once during Phase 1
  verification on this Windows/Node 24 environment (`Assertion failed:
  !(handle->flags & UV_HANDLE_CLOSING)` from libuv, thrown *after* all pages had already
  generated correctly). Multiple immediate reruns succeeded cleanly with no errors. This
  reads as a native-addon/Node-version teardown race (esbuild/sharp), not anything wrong with
  the CMS integration or its output — but if `astro build` ever reports a non-zero exit here,
  check `dist/` before assuming the build actually failed.

## Future work

Not implemented in this phase, deliberately (see `docs/ARCHITECTURE.md` §20's phase boundaries
and this doc's Cloudflare compatibility section):

- A public media-serving endpoint, so featured images become renderable.
- SSR/webhook-triggered revalidation for `examples/astro-site`, so content edits don't require
  a manual rebuild.
- A framework-generic SDK (`@kenresoft/sdk` or similar) that `@kenresoft/astro` could become a
  thin wrapper around, for Next.js/Vue/Flutter/etc. consumers — today those frameworks call the
  public API directly, which is a fully supported, first-class path (`docs/ARCHITECTURE.md`
  §4), just without a typed client yet.
- Production Cloudflare deployment of `examples/astro-site` (or a real Astro site) alongside a
  real Kenresoft CMS deployment.
