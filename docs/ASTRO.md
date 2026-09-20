# Astro Integration

**Status: Phase 1 (local integration) complete, 2026-08-27. Phase 2 (production deployment)
not started.** See `docs/ARCHITECTURE.md` §15 for how this fits the broader architecture, and
§20 (Implementation Roadmap) for where it sits in the project's phases.

## What Kenresoft CMS is

Kenresoft CMS is a **frontend-agnostic, API-first** content management platform. The CMS
(Worker + D1 + R2, `apps/api`) and its admin UI (`apps/admin`) are one deployable unit; anyone
consuming its content, a website, a mobile app, another service, talks to it exclusively
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

Despite the package name, nothing in `integrations/astro/src/index.ts` is Astro-specific:
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

- `entries.list({ contentType })`: every published entry for a content type, by slug.
- `entries.get({ contentType, slug, previewToken? })`: one published entry, or `null` if it
  doesn't exist *or* isn't published (the public API doesn't distinguish those two cases, see
  `docs/ARCHITECTURE.md` §6/§14, and neither does this client). Pass `previewToken` (e.g.
  `Astro.url.searchParams.get('preview_token')`, the param Kenresoft CMS's Live Preview button
  appends) to instead render a draft/any-status entry through the same call. See "Live
  Preview" below; the common published-only case needs no branch.
- `media.url({ id })`: the public URL for a Media item's file bytes (URL construction only,
  no fetch, use it directly as an `<img src>`). Backed by `GET /api/v1/public/media/:id/file`
  (`apps/api/src/routes/public/media.ts`), unauthenticated like the entry routes, edge-cached
  for a year via the same Cache API pattern as entries (`lib/public-cache.ts`) since media is
  immutable once uploaded, no edit endpoint, only create/delete, and invalidated on delete.
- `media.get({ id })`: `{ altText, contentType, width, height }` for a Media item, or `null`
  if it doesn't exist. Backed by `GET /api/v1/public/media/:id` (added after Public media
  serving shipped, closing the gap noted below in Known limitations' history). Everything an
  `<img>` needs beyond the src from `media.url()` above: a real `alt` and dimensions to reserve
  layout space before the file loads, instead of falling back to the entry's title.
- `media.byFolder({ slug })`: every item in a named media folder (e.g. "home-page-hero"),
  letting a frontend fetch a deliberately-curated collection explicitly instead of guessing at
  ids from the flat library. Backed by `GET /api/v1/public/media/folders/:slug`, edge-cached and
  invalidated the same way the rest of `lib/public-cache.ts` is. Returns an empty array for a
  folder slug that doesn't exist. Folders have no draft/published distinction to hide.
- `forms.submit({ formSlug, data })`: submits a public form. Rate limited server-side
  (5/60s per client IP) and validated against that form's own field definitions. There's no
  client-side equivalent of those definitions to validate against here (no public
  form-metadata endpoint either), so a validation failure only surfaces after a real request.
- `globalVariables.list()`: every global variable as a flat `Record<string, string>`, or `{}`
  if none exist. Backed by `GET /api/v1/public/global-variables`
  (`apps/api/src/routes/public/global-variables.ts`), unauthenticated and edge-cached the same
  way entries/media are. One cache key for the whole map, since (unlike entries/media) there's
  no per-key sub-resource. For genuinely arbitrary, schema-less values. See "Where public site
  config lives" below.
- `settings.general()/.contact()/.social()/.navigation()/.footer()/.seo()`: each Structured
  Settings module (`docs/ARCHITECTURE.md` §6.2), backed by `GET /api/v1/public/settings/:module`
  (`apps/api/src/routes/public/structured-settings.ts`), unauthenticated and edge-cached per
  module. Resolves that module's own typed shape (e.g. `social()` returns `{ links: [...] }`),
  or `{}`, never `null`, for a module that's never been saved in the admin. The intended home
  for anything with a stable shape a frontend renders. See "Where public site config lives"
  below.
- A `KenresoftApiError` thrown for any other non-2xx response from `entries.*`/`media.*`/
  `globalVariables.*`/`settings.*`'s underlying fetch, carrying the HTTP status; for
  `forms.submit`, thrown for *any* non-2xx response (400/404/429 are all meaningful outcomes
  here, not something to paper over), with `issues` populated for a 400 (the field-level
  validation errors).

This covers the entire public API surface (`docs/ARCHITECTURE.md` §8). There's nothing else
public to wrap. The admin API (creating/editing content types, entries, media, users, forms)
is deliberately never exposed here; that boundary is the whole point of the CMS-first
architecture (§4/§9), not something this client works around.

There's deliberately no `contentTypes.list()`/`contentTypes.get()`. The public API has no
endpoint for content-type metadata (field definitions, etc.). Only `apps/admin`'s
authenticated admin API can see that. A content type is only ever addressed by its slug when
fetching entries, which the client already supports; there was nothing else to wrap.

### Where public site config lives

Three places, each with a real boundary (`docs/ARCHITECTURE.md` §6.2 has the full model):

- **Structured Settings**: `cms.settings.general()/.contact()/.social()/.navigation()/.footer()/
  .seo()` above. Is the intended home for anything with a *stable shape* a frontend renders: a
  site name, a typed social-links collection, primary navigation, footer content, SEO defaults.
  Each module is a real Zod schema, so these calls resolve real TypeScript types instead of a
  loosely-typed string map.
- **Global Variables** (`globalVariables.list()`) stays the home for genuinely arbitrary,
  schema-less values, a promo banner's text, a one-off custom value, a feature flag, that
  don't (yet, or ever) justify a stable schema of their own.
- **Settings** (admin-only, `GET`/`PUT /api/v1/admin/settings`) is never public, `featureFlags`/`previewUrl`/`name` are CMS-internal operational configuration, not site content,
  and this client has no wrapper for it at all.

This wasn't the first attempt at the boundary. Settings briefly also carried `contactEmail`/
`socialLinks` fields that looked purpose-built for public site config but had no route of their
own and no functional consumer. Removed (migration `0024_volatile_spiral.sql`) in favor of
Global Variables, which at the time was the only public, schema-less mechanism available; any
existing `contactEmail` became a `contact_email` Global Variable, and each `socialLinks` entry
became `social_<key>`. That mechanism, in turn, meant every contact/social/footer value ended up
as an ungrouped, unvalidated string keyed by a hand-typed prefix convention. Workable, but not
what a "real CMS" needs once a production site actually depends on it. Structured Settings is the
resolution: a one-time, idempotent, admin-triggered import
(`POST /api/v1/admin/structured-settings/migrate-legacy`, surfaced as "Import into Structured
Settings" on the Global Variables page) copies exactly the known legacy keys above (`site_name`,
`tagline`, `contact_email`/`phone`/`address`, `social_*`, `footer_copyright`) into the matching
module, never touches anything else, and is safe to run more than once. Nothing is deleted:
existing Global Variables (including ones the migration doesn't recognize) are left exactly as
they are. `Settings.name` still stays where it is. It's the deployment's own admin-facing
identity (admin sidebar, browser tab), never site-facing content, and distinct from Structured
Settings' own `general.siteName` (the public site's name, editable from Settings → General →
"Site branding").

## Connecting your own, separately-hosted Astro project

Everything above documents how `@kenresoft-cms/astro` is developed and referenced *inside* this
monorepo (`examples/astro-site` as a pnpm workspace member). Most people reading this doc are
not working inside this monorepo at all. They have their own Astro project and their own
deployed Kenresoft CMS (or one they're about to deploy, see `docs/DEPLOYMENT.md`), and just
want to fetch content from it. That's a normal npm install, nothing monorepo-specific:

```bash
npm install @kenresoft-cms/astro
```

Published under the `@kenresoft-cms` npm scope, same as `@kenresoft-cms/contracts` and
`@kenresoft-cms/create`. See `integrations/astro/README.md`'s "Connecting your own Astro
project" section for a complete, minimal working example (client setup, env var, one page
fetching one entry). The fastest path to a working starting point is the scaffolding CLI:

```bash
npm create @kenresoft-cms@latest my-site -- --astro
```

This copies a small, generic starter (content-agnostic, it doesn't assume Commerce, customer
accounts, or any of `examples/astro-site`'s specific content types) with `@kenresoft-cms/astro`
already wired up, ready to point at your own deployment's URL. See the root
[README](../README.md) and [`packages/create`](../packages/create) for what it scaffolds and how
it differs from the full CMS scaffold (`npm create @kenresoft-cms@latest my-cms`, no flag). The
Astro starter is a one-time template copy with no ongoing upstream-merge relationship, unlike the
full CMS scaffold's `pnpm run update`.

`examples/astro-site` itself stays what it's always been: the *fullest* reference. The whole
Commerce plugin (catalog, cart, checkout, customer accounts), forms, media, and the Page/Block
system. Meant to be read as a worked example and seeded against a matching local deployment
(`examples/astro-site/README.md`'s "Prerequisites: seeding a fresh deployment" section), not
cloned as a starting point for an arbitrary CMS deployment with different content types. The new
`--astro` scaffold exists specifically to fill the gap between "read the reference site's source"
and "hand-write a client from the raw REST API" for someone who just wants a working Astro site
pointed at their own content.

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
(`pnpm-workspace.yaml` lists `integrations/*` and `examples/*` alongside `apps/*`/`packages/*`).
A plain `pnpm install` at the repo root wires `@kenresoft-cms/astro` into the example via a
workspace symlink, same as any other internal package. There is no separate install step and
no `--ignore-workspace` flag needed; an earlier version of this example was deliberately kept
outside the workspace to mimic an external consumer, but that made consuming
`@kenresoft-cms/astro` from it awkward for no real benefit. A real SDK's own example app living in
the SDK's own monorepo is a completely standard pattern.

## Environment variables

`examples/astro-site/.env` (copy from `.env.example`):

```
PUBLIC_KENRESOFT_CMS_URL=http://localhost:8787
```

The `PUBLIC_` prefix is Astro's convention for env vars that are safe to ship to the browser:
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

This means a published edit is visible on the very next request. No rebuild step. This
replaced an earlier static-output design (Astro's `getStaticPaths()`) specifically because
static output froze the blog's route list at build time: a brand-new post 404'd on the live
site until the next manual `astro build`, and an edit to an existing post's content likewise
didn't show until a rebuild. `blog/[slug].astro` fetches its entry per-request and 404s itself
when the slug doesn't resolve, rather than pre-generating a fixed list of paths.

Static output was the right choice for Phase 1's first vertical slice (the simplest reliable
strategy, matching `docs/ARCHITECTURE.md` §20.1's "Astro renders the post" framing) but stopped
being the right default once "does a new post actually appear" became something worth verifying
end-to-end. `@kenresoft-cms/astro`'s client has no build-time-only assumptions either way. It's
just `fetch`, equally callable from a static `getStaticPaths()` page or an SSR one. So this was
a config change in this example plus dropping `getStaticPaths()` from one page, not a redesign
of the CMS API or the client.

### Live Preview requires the page to render on demand: static output alone 404s every draft

**Root cause of reported "previewing a draft 404s" issues.** This was missed when Live Preview's
`previewToken` support shipped (see "Live Preview" below). That fix is entirely about what a page
*does* once it runs, but under Astro's default `output: 'static'` with `getStaticPaths()`, a
dynamic route like `[slug].astro` only ever gets a real, buildable page for the exact params
`getStaticPaths()` returned. A content type's own `getStaticPaths()` implementation almost always
lists only published entries (this project's own historical static-output design did exactly
that, per the note above). A draft's slug was simply never one of the params a static build
generated, so Astro 404s the request itself, before any page code (any `previewToken` handling
included) ever runs. This isn't a CMS/SDK bug to fix server-side; it's an Astro routing-mode
requirement your own page has to satisfy.

**The fix, on your side:** the page that's supposed to support Live Preview needs to render
on-demand, not be frozen to a build-time path list. Two ways to get there, in order of how much of
your site it affects:

1. **Whole site is SSR already** (`output: 'server'` in `astro.config.mjs`, what
   `examples/astro-site` and the `npm create @kenresoft-cms@latest ... --astro` starter both use).
   Nothing to do. Every route renders per-request by default.
2. **Site is static output, one route needs to support previews**: opt just that page out of
   prerendering, leaving the rest of the site fully static:

   ```astro
   ---
   // src/pages/blog/[slug].astro
   export const prerender = false; // required for Live Preview — see docs/ASTRO.md

   import { cms } from '../../lib/cms';

   const previewToken = Astro.url.searchParams.get('preview_token');
   const post = await cms.entries.get({ contentType: 'blog-post', slug: Astro.params.slug!, previewToken });
   if (!post) return new Response(null, { status: 404 });
   ---
   ```

   Requires a deploy adapter that supports on-demand rendering (`@astrojs/cloudflare`,
   `@astrojs/node`, etc., the same one your `output: 'server'` sites already use); a purely
   static host with no adapter at all can't do this for any route, static output included.
   `getStaticPaths()` becomes unnecessary/unused on a `prerender: false` page. Remove it if
   present, since it no longer does anything.

If you've confirmed the page *does* render on demand (SSR, or `prerender = false`) and a draft
still 404s, that's a genuine bug. Check the token hasn't expired (15 minutes), that the URL's
`?preview_token=` matches exactly what the Entry/Page Editor's "Live Preview" button generated
(don't hand-edit or reuse an old one), and that `entries.get()`/`pages.resolve()` is actually
receiving it (log `previewToken` before the fetch) rather than a stale `undefined`.

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
pass both ran against it), but a production Astro deployment alongside it, `apps/admin` has no
deployed home yet either. Is still not provisioned or tested. Getting there is genuinely a
distinct next phase, not a small extension of this one.

## Field rendering (Phase 1 of the schema-driven frontend work)

**Status: implemented, foundation only.** `@kenresoft-cms/astro` exports a small, read-only
field-renderer registry (`integrations/astro/src/render/field-renderers.ts`), independent of
`apps/admin`'s editing components. This package renders *static display output* for a
visitor, not editable widgets for an admin.

```ts
import { renderField, registerFieldRenderer } from '@kenresoft-cms/astro';

// Given a field descriptor and a raw value, resolve the right display shape:
const result = renderField({ fieldType: 'rich_text', label: 'Body' }, entry.data.body);
// => { kind: 'html', value: '<p>...</p>' }

// Override how a field type — or a specific field via its `presentation.renderer` name —
// is displayed:
registerFieldRenderer('richText', (field, value) => ({ kind: 'html', value: myTransform(value) }));
```

`renderField()` returns one of a closed set of shapes (`text`, `html`, `number`, `boolean`,
`date`, `link`, `image`, `relation`, `list`, `empty`). Deliberately not raw markup, so a
template decides how each `kind` actually renders. `rich_text` is the one exception
(`{kind: 'html', value}`): that value is already trusted, editor-authored HTML, the same trust
boundary this example site's own `set:html` usage on the blog page already relies on. This
renderer introduces no new one.

**Resolution order** (a field's `presentation.renderer`, if set on the `FieldDefinition` →
that name's registered renderer → the built-in default for the field's `fieldType` → a safe
text-stringifying fallback) is documented in full, with the security reasoning for why a
renderer name can never cause code execution, in the doc comment above
`resolveFieldRenderer()` in that same file and in `docs/ARCHITECTURE.md` §6.3.

**What this does NOT do yet**: there is no `client.contentTypes.fields()` call and no public
API endpoint that returns a content type's field definitions (including `presentation`) to a
frontend. See "No public content-type metadata endpoint" immediately below, which this phase
doesn't change. `renderField()` is ready to consume a `{fieldType, label, presentation}`
descriptor from wherever a caller already has one; wiring it to an actual CMS fetch, and
building the Pages/Blocks system this registry exists to eventually support, is tracked in
`docs/SITE_BUILDER.md` (still entirely unimplemented, no Pages, Blocks, Templates, or dynamic
routing exist in this codebase yet).

## Dynamic content routing (Phase 2 of the schema-driven frontend work)

**Status: implemented, SDK primitive only. Not wired into `examples/astro-site` yet.** A
content type can declare a `routePattern` in the CMS admin (e.g. `/blog/{slug}`). V1 supports
exactly one required `{slug}` parameter, nothing richer (no multiple params, optional
segments, wildcards, regex, or localization segments; see `docs/SITE_BUILDER.md` §14 decision
#2 for the full reasoning and future-extensibility note).

```ts
import { resolveRoute } from '@kenresoft-cms/astro';

const patterns = await cms.routePatterns.list(); // [{ contentTypeSlug, routePattern }, ...]
const result = resolveRoute('/blog/hello-world', patterns);
// => { kind: 'entry', contentTypeSlug: 'blog', slug: 'hello-world' }

if (result.kind === 'entry') {
  const entry = await cms.entries.get({ contentType: result.contentTypeSlug, slug: result.slug });
  // ... render entry, e.g. via renderField() for each of its fields
}
```

`client.routePatterns.list()` matches `GET /api/v1/public/route-patterns`. Deliberately
narrow, `{contentTypeSlug, routePattern}` pairs only, never field definitions. **This is not
the "public content-type metadata" endpoint** the Known limitations section below still flags
as an unresolved product decision. A route pattern reveals only a URL shape a visitor could
already discover by requesting the page, a much narrower disclosure than a content type's
field list.

`resolveRoute()`/`matchRoutePattern()` are pure functions
(`integrations/astro/src/render/resolve-route.ts`), unit-tested
(`integrations/astro/test/resolve-route.test.ts`). `resolveRoute()`'s result is a
discriminated union (`{kind: 'entry', ...} | {kind: 'notFound'}`) deliberately shaped so a
`page` variant can be added later (once Pages exist, `docs/SITE_BUILDER.md` Phase 3+) without
breaking existing callers.

`examples/astro-site` now wires this in via `resolveSiteRoute()` (Phase 7 below), layering an
exact-match Page route check on top of the same `resolveRoute()` content-type resolution. See
the next section.

## Page/Block rendering (Phase 7 of the schema-driven frontend work)

**Status: implemented.** `examples/astro-site` gained `src/pages/[...route].astro`, a generic
catch-all reached only for a pathname that doesn't match one of the site's own hand-authored
static routes (Astro's routing always prefers a static/named-param route over a rest-parameter
catch-all). It resolves the path via `resolveSiteRoute(pathname, pages, patterns)`. A new
layer on top of Phase 2's `resolveRoute()` that checks a Page's exact literal `route` first
(Pages have no `{slug}` grammar), falling back to content-type pattern matching:

```ts
import { createKenresoftClient, resolveSiteRoute } from '@kenresoft-cms/astro';

const cms = createKenresoftClient({ url: PUBLIC_KENRESOFT_CMS_URL });
const [pages, patterns] = await Promise.all([cms.pages.list(), cms.routePatterns.list()]);
const result = resolveSiteRoute(pathname, pages, patterns);
// => { kind: 'page', route } | { kind: 'entry', contentTypeSlug, slug } | { kind: 'notFound' }
```

For a `page` result, the full Page is fetched via `cms.pages.resolve({ route })` and rendered
through `<PageRenderer page={page} cms={cms} />`.

**A real bug, found and fixed after this was first written**: a `?preview_token=` request was
originally handled by first resolving the route through `resolveSiteRoute()` (the flow above),
*then* calling `pages.resolve({ route, previewToken })`/`pages.preview({ route, token })` for a
`page` result. That's backwards for the one case Live Preview actually exists for, `cms.pages
.list()` only ever returns *published* pages, so a draft Page's route is never in that list,
`resolveSiteRoute()` returns `notFound` for it, and the catch-all 404s before the preview branch
is ever reached. Fixed by checking for a token *first*: when one is present, skip the published-
only `pages.list()`/`routePatterns.list()` lookup entirely and call
`cms.pages.resolve({ route: pathname, previewToken })` directly against the raw pathname. Safe
to do unconditionally, since a Page preview link (from Settings → API → Live Preview → "Page
preview URL") only ever points at this catch-all with a literal route, never an entry preview
link (entries route through their own dedicated per-content-type pages, which Astro always
matches before falling through here).

**A deliberate, documented deviation from `docs/SITE_BUILDER.md`'s original §5 sketch**: that
document imagined `@kenresoft-cms/astro` itself shipping `<PageRenderer>`/`<BlockRenderer>` and a
built-in Hero/RichText/Image/CTA/Columns/Spacer component set. In practice, `@kenresoft-cms/astro`
has no Astro/React/JSX dependency at all (the same reasoning `renderField()`'s own doc comment
already gives for why field rendering returns a plain data shape rather than markup). A real
component is inherently framework-specific. So the SDK ships only the framework-agnostic half:
`registerBlockRenderer(blockType, component)`/`resolveBlockRenderer(blockType)`
(`integrations/astro/src/render/block-renderers.ts`), a developer-override registry holding
`unknown` component references. The actual built-in components:
`examples/astro-site/src/components/blocks/{Hero,RichText,Image,Cta,Columns,Spacer}Block.astro`,
plus `BlockRenderer.astro` (resolves one block: `resolveBlockRenderer(type) ?? BUILT_IN_BLOCKS[type]`,
so an explicit override always wins regardless of import order, the override and the built-in
map are two separate objects a caller combines itself, never one mutable map where later
registration could silently clobber an earlier one) and `PageRenderer.astro`. Live in
`examples/astro-site` instead, the one real Astro consumer that can hold `.astro` files at all.
A `reusableBlockRef` block is special-cased in `BlockRenderer.astro`: it fetches the referenced
block's live type/config via the new `cms.reusableBlocks.get({ id })` (backed by a new public
`GET /api/v1/public/reusable-blocks/:id`, since rendering a live reference needs the referenced
block's current data, not a copy) before resolving a component for it. A dangling reference (the
reusable block was deleted) or an unrecognized block type both silently render nothing rather
than failing the whole page.

**What this does NOT do yet**: no drag-and-drop visual editor (Phase 8, the underlying
data/rendering model built here is designed not to need a rewrite when that ships); no
plugin-contributed block types (Phase 9). A route collision between a Page and one of this
example's own static files (e.g. an admin creating a Page at `/about`) is a known,
example-specific limitation. The static file always wins and the CMS Page is never reached; see
the code comment at the top of `[...route].astro`.

## Live Preview

**Global, zero-per-page-code default (`@kenresoft-cms/astro` 0.4.0+, current recommendation).**
`createKenresoftClient({ previewToken })` binds a client to one request's Live Preview token:
every `entries.get()`/`pages.resolve()` call made through it picks that up automatically, with no
`?preview_token=` handling in the page itself. Paired with `getPreviewToken(input)` (accepts
`Astro.url`, an absolute URL string, or `Astro.request`; returns `null` when the param is absent.
Always safe to pass straight through) and Astro middleware, this makes Live Preview work
everywhere for free:

```ts
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';
import { createKenresoftClient, getPreviewToken } from '@kenresoft-cms/astro';

export const onRequest = defineMiddleware((context, next) => {
  context.locals.cms = createKenresoftClient({
    url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL,
    previewToken: getPreviewToken(context.url),
  });
  return next();
});
```

Every page that then reads `Astro.locals.cms.entries.get({ contentType, slug })` (no
`previewToken` argument at all) transparently renders a draft when the request carries one. Both
`examples/astro-site` (its `blog/[slug].astro` and the Page-rendering `[...route].astro`, the only
two files that ever handled preview tokens) and the `npm create @kenresoft-cms@latest ... --astro`
starter (a new `src/middleware.ts`, `blog/[slug].astro` reading from `Astro.locals.cms`) were
updated to this pattern. Passing `previewToken: null`. At client creation or on one call:
always forces normal published-only rendering even when a client-level default is set; an
individual call's own explicit `previewToken` still overrides the client default either way. See
`integrations/astro/README.md`'s "Live Preview (draft rendering)" section for the full picture,
including the equivalent no-middleware, per-call form.

**A real, found-and-fixed bug specific to the Page-rendering catch-all** (`[...route].astro` in
both `examples/astro-site` and this site, see the "Page/Block rendering" section above for the
full writeup): the original implementation resolved a Page's route against `cms.pages.list()`
*before* ever checking for a preview token. But `pages.list()` only ever returns *published*
pages, so a draft Page's route was never in that list and the catch-all 404'd before the preview
branch could run at all, defeating the entire point of Live Preview for a draft Page specifically
(published-Page preview, and every entry preview, were unaffected). Fixed by checking for a token
first and calling `pages.resolve({ route: pathname })` directly against the raw pathname in that
case, skipping the published-only list lookup entirely.

Every entry-backed template, `blog/[slug].astro`, `about.astro`, `contact.astro`,
`categories/[slug].astro` in `examples/astro-site`. Supports Live Preview this way. Commerce's
`shop/[slug].astro` (product pages) is **not** covered. Products aren't Entries and have no
preview-token route of their own.

**Reaching an existing project.** This package is still 0.x, so a caret range like `^0.3.0`
never resolves past its own minor version. A bare `pnpm update @kenresoft-cms/astro` can't cross
0.3 → 0.4. Install explicitly instead: `pnpm add @kenresoft-cms/astro@latest` (or the npm/yarn
equivalent), then adopt the middleware pattern above (or the simpler per-call form) in your own
templates. Without waiting on this repo's example code or reading its source.

## Known limitations

- **No public content-type metadata endpoint. By design, not a bug.** A generic Astro page
  can't discover a content type's field list at build/request time; it has to know the field
  names it expects in advance (as `examples/astro-site`'s pages do). Exposing field
  definitions publicly is a real product decision (it reveals internal content-modeling
  structure to anyone), not something to add unilaterally. Flagged here as a decision point
  for whoever owns that call, not committed to either way.
- A rare, non-deterministic `astro build` exit-code flake was observed once during Phase 1
  verification on this Windows/Node 24 environment (`Assertion failed:
  !(handle->flags & UV_HANDLE_CLOSING)` from libuv, thrown *after* all pages had already
  generated correctly). Multiple immediate reruns succeeded cleanly with no errors. This
  reads as a native-addon/Node-version teardown race (esbuild/sharp), not anything wrong with
  the CMS integration or its output. But if `astro build` ever reports a non-zero exit here,
  check `dist/` before assuming the build actually failed.

### Troubleshooting: "your custom src/fetch.ts does not call the actions()/middleware() handler"

Not a Kenresoft CMS or `@kenresoft-cms/astro` issue. Confirmed by reading Astro 7.x's own
source (`astro/dist/core/fetch/vite-plugin.js`) and by reproducing (or rather, failing to
reproduce) it against `examples/astro-site` itself, which has never had a `src/fetch.ts` at any
point in its history and doesn't trigger this warning when actually run. `@kenresoft-cms/astro`
is a plain fetch-wrapper client with zero Astro integration hooks (no middleware, no actions) and
can't be the source either.

This is a real Astro 7.x feature (`virtual:astro:fetchable`): it fires only when your **own**
project has a `src/fetch.ts` (or `.js`/`.mjs`) file, Astro resolves it as a custom low-level
fetch handler, replacing its own default one, and warns once your project uses Actions or
middleware if that file doesn't forward through them. If you've added one yourself (most
Kenresoft-CMS-backed Astro sites don't need to, every page here is a stateless per-request
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

The default export must be an **object with a `fetch` method**. Matching the standard
Cloudflare Workers module-worker shape (`export default { fetch, scheduled?, ... }`), since
that's exactly what `@astrojs/cloudflare` bridges to. Astro calls it as
`fetchHandler.fetch(request)` (confirmed in `astro/dist/core/app/base.js`), not as a bare
function. A plain `export default async function fetch(request) {...}` throws at runtime
(`fetch is not a function`) once Astro actually tries to invoke it.

## Future work

Not implemented, deliberately (see `docs/ARCHITECTURE.md` §20's phase boundaries and this
doc's Cloudflare compatibility section). Listed as open decisions, not commitments:

- **Public content-type metadata**: see Known limitations above; a decision point, not a gap
  being tracked toward a default "yes."
- A framework-generic SDK (`@kenresoft-cms/sdk` or similar) that `@kenresoft-cms/astro` could become a
  thin wrapper around, for Next.js/Vue/Flutter/etc. consumers. Today those frameworks call the
  public API directly, which is a fully supported, first-class path (`docs/ARCHITECTURE.md`
  §4), just without a typed client yet.
- Production Cloudflare deployment of `examples/astro-site` (or a real Astro site) alongside a
  real Kenresoft CMS deployment.
