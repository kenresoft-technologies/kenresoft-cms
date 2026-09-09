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
maintains a typed client for it: `@kenresoft-cms/astro` (`integrations/astro/`). Its entire purpose
is removing the need to hand-write `fetch()` calls and re-derive the public API's response
shape from scratch:

```ts
import { createKenresoftClient } from '@kenresoft-cms/astro';

const cms = createKenresoftClient({ url: 'http://localhost:8787' });

const posts = await cms.entries.list({ contentType: 'blog-post' });
const post = await cms.entries.get({ contentType: 'blog-post', slug: 'hello-world' });
```

Despite the package name, nothing in `integrations/astro/src/index.ts` is Astro-specific —
it's a plain, isomorphic `fetch` wrapper. It's positioned as *the* Astro integration because
Astro is this project's first-class frontend target (`docs/ARCHITECTURE.md` §2/§15), not
because the code needs Astro to run. Other frameworks are expected to call the public API
directly rather than through this package, at least for now (see Future work below).

### Why not `@kenresoft-cms/cms-sdk`, why not framework-generic?

An earlier draft of `docs/ARCHITECTURE.md` §15 sketched a hypothetical `@kenresoft-cms/cms-sdk`.
This implementation uses `@kenresoft-cms/astro` instead, matching Astro's own convention for
official integrations (`@astrojs/<name>`-style naming) and keeping the scope honest: this
package was built for, and tested against, one framework. A framework-generic SDK is future
work, not a rename of this package (see Future work).

### What the client covers today

- `entries.list({ contentType })` — every published entry for a content type, by slug.
- `entries.get({ contentType, slug })` — one published entry, or `null` if it doesn't exist
  *or* isn't published (the public API doesn't distinguish those two cases — see
  `docs/ARCHITECTURE.md` §6/§14 — and neither does this client).
- `media.url({ id })` — the public URL for a Media item's file bytes (URL construction only,
  no fetch — use it directly as an `<img src>`). Backed by `GET /api/v1/public/media/:id/file`
  (`apps/api/src/routes/public/media.ts`), unauthenticated like the entry routes, edge-cached
  for a year via the same Cache API pattern as entries (`lib/public-cache.ts`) since media is
  immutable once uploaded — no edit endpoint, only create/delete — and invalidated on delete.
- `media.get({ id })` — `{ altText, contentType, width, height }` for a Media item, or `null`
  if it doesn't exist. Backed by `GET /api/v1/public/media/:id` (added after Public media
  serving shipped, closing the gap noted below in Known limitations' history) — everything an
  `<img>` needs beyond the src from `media.url()` above: a real `alt` and dimensions to reserve
  layout space before the file loads, instead of falling back to the entry's title.
- `forms.submit({ formSlug, data })` — submits a public form. Rate limited server-side
  (5/60s per client IP) and validated against that form's own field definitions — there's no
  client-side equivalent of those definitions to validate against here (no public
  form-metadata endpoint either), so a validation failure only surfaces after a real request.
- `globalVariables.list()` — every global variable as a flat `Record<string, string>`, or `{}`
  if none exist. Backed by `GET /api/v1/public/global-variables`
  (`apps/api/src/routes/public/global-variables.ts`), unauthenticated and edge-cached the same
  way entries/media are — one cache key for the whole map, since (unlike entries/media) there's
  no per-key sub-resource. The natural home for site-wide config a template needs at render
  time and an editor manages from Settings → General/Social's fields don't otherwise cover —
  see "Where public site config lives" below.
- A `KenresoftApiError` thrown for any other non-2xx response from `entries.*`/`media.*`/
  `globalVariables.*`'s underlying fetch, carrying the HTTP status; for `forms.submit`, thrown
  for *any* non-2xx response (400/404/429 are all meaningful outcomes here, not something to
  paper over), with `issues` populated for a 400 (the field-level validation errors).

This covers the entire public API surface (`docs/ARCHITECTURE.md` §8) — there's nothing else
public to wrap. The admin API (creating/editing content types, entries, media, users, forms)
is deliberately never exposed here; that boundary is the whole point of the CMS-first
architecture (§4/§9), not something this client works around.

There's deliberately no `contentTypes.list()`/`contentTypes.get()`. The public API has no
endpoint for content-type metadata (field definitions, etc.) — only `apps/admin`'s
authenticated admin API can see that. A content type is only ever addressed by its slug when
fetching entries, which the client already supports; there was nothing else to wrap.

### Where public site config lives

**Global Variables is the intended home for anything a public frontend needs to render** — a
contact email, social links, a phone number, a footer copyright line, a promo banner. Settings
(admin-only, `GET`/`PUT /api/v1/admin/settings`) used to also carry `contactEmail`/`socialLinks`
fields that looked purpose-built for exactly this, sitting alongside `corsOrigin`/
`featureFlags`/`previewUrl`, which are genuinely CMS-internal and must stay admin-only. In
practice those two fields had no route of their own and no functional consumer anywhere in this
codebase — a half-finished feature, not a real alternative — while Global Variables already had
everything this needs: a public, unauthenticated, edge-cached route
(`globalVariables.list()` above), arbitrary key names instead of a fixed schema, and an admin UI
with a "Site Info" template (Global Variables page → Examples) that creates `contact_email`,
`social_twitter`, `social_facebook`, `social_instagram`, and similar keys in one step.

Resolved by removing `contactEmail`/`socialLinks` from Settings entirely (migration
`0024_volatile_spiral.sql`) rather than leaving both mechanisms around to keep duplicating each
other, which is exactly the confusion that prompted this decision — a real migration project,
mid-adoption, had already started hand-copying contact/social info into Global Variables as a
workaround. The migration doesn't just drop the columns: any existing non-null `contactEmail`
becomes a `contact_email` Global Variable, and each key in `socialLinks` becomes `social_<key>`
(`social_twitter`, `social_facebook`, etc.) — skipped if a variable with that exact key already
exists, so it never overwrites something you'd already created yourself. Settings → Social in
the admin now points at Global Variables instead of duplicating it. `Settings.name` stays where
it is — it's the deployment's own identity (admin sidebar, browser tab), not site-facing content.

## How Astro communicates with the CMS

```
Kenresoft CMS/API (wrangler dev, :8787)
        |
        |  GET /api/v1/public/:contentType
        |  GET /api/v1/public/:contentType/:slug
        |  GET /api/v1/public/media/:id/file
        v
@kenresoft-cms/astro  (integrations/astro)
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
pnpm --filter @kenresoft-cms/api dev        # http://localhost:8787

# Terminal 2 — the Astro example
pnpm --filter kenresoft-cms-example-astro dev   # http://localhost:4321
```

(Or `pnpm dev` at the repo root, which starts every workspace app's dev server in parallel,
including both of the above.)

Both `integrations/astro` and `examples/astro-site` are ordinary pnpm workspace members
(`pnpm-workspace.yaml` lists `integrations/*` and `examples/*` alongside `apps/*`/`packages/*`)
— a plain `pnpm install` at the repo root wires `@kenresoft-cms/astro` into the example via a
workspace symlink, same as any other internal package. There is no separate install step and
no `--ignore-workspace` flag needed; an earlier version of this example was deliberately kept
outside the workspace to mimic an external consumer, but that made consuming
`@kenresoft-cms/astro` from it awkward for no real benefit — a real SDK's own example app living in
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

`examples/astro-site` uses server rendering (`astro.config.mjs`: `output: 'server'`, the
`@astrojs/cloudflare` adapter). Every page fetches from the CMS **at request time**:

```
   Request
      ↓
 astro-site (SSR)
      ↓
CMS public API (its own edge cache — docs/ARCHITECTURE.md §12)
```

This means a published edit is visible on the very next request — no rebuild step. This
replaced an earlier static-output design (Astro's `getStaticPaths()`) specifically because
static output froze the blog's route list at build time: a brand-new post 404'd on the live
site until the next manual `astro build`, and an edit to an existing post's content likewise
didn't show until a rebuild. `blog/[slug].astro` fetches its entry per-request and 404s itself
when the slug doesn't resolve, rather than pre-generating a fixed list of paths.

Static output was the right choice for Phase 1's first vertical slice (the simplest reliable
strategy, matching `docs/ARCHITECTURE.md` §20.1's "Astro renders the post" framing) but stopped
being the right default once "does a new post actually appear" became something worth verifying
end-to-end. `@kenresoft-cms/astro`'s client has no build-time-only assumptions either way — it's
just `fetch`, equally callable from a static `getStaticPaths()` page or an SSR one — so this was
a config change in this example plus dropping `getStaticPaths()` from one page, not a redesign
of the CMS API or the client.

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
own Cloudflare deployment. A real CMS deployment now exists (`apps/api`'s `wrangler.toml` has
real D1/R2 resource ids, and `docs/DEPLOYMENT.md`'s backup drill and the security-hardening
pass both ran against it), but a production Astro deployment alongside it — `apps/admin` has no
deployed home yet either — is still not provisioned or tested. Getting there is genuinely a
distinct next phase, not a small extension of this one.

## Known limitations

- **No public content-type metadata endpoint — by design, not a bug.** A generic Astro page
  can't discover a content type's field list at build/request time; it has to know the field
  names it expects in advance (as `examples/astro-site`'s pages do). Exposing field
  definitions publicly is a real product decision (it reveals internal content-modeling
  structure to anyone), not something to add unilaterally — flagged here as a decision point
  for whoever owns that call, not committed to either way.
- A rare, non-deterministic `astro build` exit-code flake was observed once during Phase 1
  verification on this Windows/Node 24 environment (`Assertion failed:
  !(handle->flags & UV_HANDLE_CLOSING)` from libuv, thrown *after* all pages had already
  generated correctly). Multiple immediate reruns succeeded cleanly with no errors. This
  reads as a native-addon/Node-version teardown race (esbuild/sharp), not anything wrong with
  the CMS integration or its output — but if `astro build` ever reports a non-zero exit here,
  check `dist/` before assuming the build actually failed.

### Troubleshooting: "your custom src/fetch.ts does not call the actions()/middleware() handler"

Not a Kenresoft CMS or `@kenresoft-cms/astro` issue — confirmed by reading Astro 7.x's own
source (`astro/dist/core/fetch/vite-plugin.js`) and by reproducing (or rather, failing to
reproduce) it against `examples/astro-site` itself, which has never had a `src/fetch.ts` at any
point in its history and doesn't trigger this warning when actually run. `@kenresoft-cms/astro`
is a plain fetch-wrapper client with zero Astro integration hooks (no middleware, no actions) and
can't be the source either.

This is a real Astro 7.x feature (`virtual:astro:fetchable`): it fires only when your **own**
project has a `src/fetch.ts` (or `.js`/`.mjs`) file — Astro resolves it as a custom low-level
fetch handler, replacing its own default one, and warns once your project uses Actions or
middleware if that file doesn't forward through them. If you've added one yourself (most
Kenresoft-CMS-backed Astro sites don't need to — every page here is a stateless per-request
fetch from the public API, no Actions or middleware of the CMS's own), either remove it if it's
not actually needed, or make sure it calls through Astro's public `astro/fetch` API, matching
the same order Astro's own default handler uses internally:

```ts
// src/fetch.ts
import { FetchState, middleware, actions, astro } from 'astro/fetch';

export default {
  async fetch(request: Request): Promise<Response> {
    const state = new FetchState(request);
    return middleware(state, async (state) => {
      const actionResponse = await actions(state);
      return actionResponse ?? astro(state);
    });
  },
};
```

The default export must be an **object with a `fetch` method** — matching the standard
Cloudflare Workers module-worker shape (`export default { fetch, scheduled?, ... }`), since
that's exactly what `@astrojs/cloudflare` bridges to. Astro calls it as
`fetchHandler.fetch(request)` (confirmed in `astro/dist/core/app/base.js`), not as a bare
function — a plain `export default async function fetch(request) {...}` throws at runtime
(`fetch is not a function`) once Astro actually tries to invoke it.

## Future work

Not implemented, deliberately (see `docs/ARCHITECTURE.md` §20's phase boundaries and this
doc's Cloudflare compatibility section) — listed as open decisions, not commitments:

- **Public content-type metadata** — see Known limitations above; a decision point, not a gap
  being tracked toward a default "yes."
- A framework-generic SDK (`@kenresoft-cms/sdk` or similar) that `@kenresoft-cms/astro` could become a
  thin wrapper around, for Next.js/Vue/Flutter/etc. consumers — today those frameworks call the
  public API directly, which is a fully supported, first-class path (`docs/ARCHITECTURE.md`
  §4), just without a typed client yet.
- Production Cloudflare deployment of `examples/astro-site` (or a real Astro site) alongside a
  real Kenresoft CMS deployment.
