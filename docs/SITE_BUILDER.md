# Schema-Driven Frontend & Site Builder — Phase 0 Architecture Assessment

## Status

Phase 0 (this document's original architecture assessment) is reviewed and accepted. §14's
open decisions are resolved (see "§14 decisions — resolved" below). **Phase 1** (field
presentation metadata + a field-renderer registry), **Phase 2** (content-type
`routePattern` + `resolveRoute()` in the SDK), **Phase 3** (the `pages`/`page_revisions`
data model, admin CRUD + revisions, a basic block-composition editor, and the public Pages
API), **Phase 4** (`reusable_blocks`/`templates` tables + admin UI, Page creation from a
template), **Phase 5** (Page Live Preview, reusing `preview-token.ts` verbatim), and
**Phase 6** (Navigation `pageId` reference option), **Phase 7** (Astro rendering —
`resolveSiteRoute()` in the SDK, `examples/astro-site`'s `<PageRenderer>`/`<BlockRenderer>`
and catch-all route), and **Phase 8** (drag-and-drop block editor, duplicate, undo/redo)
**are implemented**. **Phase 10**'s production hardening pass is also done (§25 — found and
fixed a real cross-route data-loss bug). Phase 9 (plugin-contributed block types) and Phase
10's "patterns/presets" half remain **not started**, both deliberately deferred pending a
concrete need or design.
Do not read anything below §2 as describing current behavior; it is the
target architecture this phase-by-phase plan is building toward.

### §14 decisions — resolved

1. **Core vs. plugin: Core.** Pages/Blocks/Templates/dynamic routing/the schema-driven
   rendering foundation ship as first-class Kenresoft CMS capabilities, not a plugin — the
   core system must remain useful with zero plugins installed. The existing plugin
   architecture is preserved unchanged and, per §9, will later let a plugin contribute custom
   block types, field types, field/block renderers, templates, and components — no second
   plugin system is being introduced for this.
2. **Route pattern syntax (v1): exactly one required `{slug}` parameter**, e.g. `/blog/{slug}`.
   No multiple parameters, optional segments, wildcards, regex, or localization parameters in
   v1. Validated: leading slash, no trailing slash except `/`, exactly one `{slug}` token, no
   duplicate/conflicting patterns among content types, no collision with a reserved path or an
   existing literal `pages.route`. The resolver (§5/§6) is designed so richer pattern grammar
   can be introduced later without rewriting the resolution mechanism itself.
3. **Visual page builder: a committed, required product capability — phased, not optional.**
   Phase 3 ships the Page/Block data model, block schemas, block registry, basic add/remove/
   reorder UI (buttons, not drag-and-drop — matching Navigation's own precedent, §1.8), nesting
   where a block type declares it, validation, persistence, revisioning, and rendering. Phase 8
   later replaces/enhances the *editing UI only* (drag-and-drop canvas, layers, inspector,
   duplicate, undo/redo, responsive preview) — Phase 3's data model and rendering architecture
   must not need a rewrite for Phase 8 to land on top of it. This is why §3.3 stores block
   composition as a JSON tree (not editor-specific structure) from the start.

---

## 1. What already exists (repository audit summary)

This section answers the audit's ten questions plainly, so the target architecture in §2
onward reads as *additions to* known state, not speculation. Full findings (file:line detail)
were gathered by an internal audit pass; the load-bearing facts are summarized here.

### 1.1 Content model (`packages/database/schema/`)
`content_types` → `field_definitions` → `entries` → `entry_revisions` is the existing
editor-authored content pipeline. Entries store `data` as an untyped JSON blob validated at
the API layer against the content type's field definitions, not at the DB layer. Media is a
separate `media` table (R2-backed, no versioning). Forms/submissions are deliberately
separate from Entries. `structured_settings` is a six-module (`general, contact, social,
navigation, footer, seo`) singleton-per-module JSON config store — **navigation already
lives here** as a flat, orderable list of `{label, url, visible, order, external, newTab}`
items, free-text `url`, no reference to any content resource. `webhooks`/`webhook_deliveries`
give durable, Cron-retried event delivery. `audit_log` records every structural/content
write. The Commerce plugin (`packages/database/schema/plugins/commerce.ts`) is the existing
precedent for a large, multi-table domain living in its own `plugin_<id>_`-prefixed schema
file, migration-generated from Core's single `drizzle-kit generate` pipeline.

### 1.2 API structure (`apps/api/src/routes/`)
One flat `OpenAPIHono` app (`apps/api/src/index.ts`) mounts `admin/*` (session + role
gated), `public/*` (rate-limited, mostly edge-cached), `system/*` (break-glass, 404 by
default), and plugin routes last. Public routes already implement the exact security
convention a Pages system needs: **a draft is byte-for-byte indistinguishable from a
nonexistent slug** (`routes/public/content.ts`). The catch-all content route is mounted
*last* specifically so named routes (`forms`, `media`, `global-variables`, `preview`,
`settings`) never collide with it — the same ordering discipline a Pages route will need
to slot into.

### 1.3 Live Preview (`apps/api/src/lib/preview-token.ts`, `routes/public/preview.ts`)
Already generalized further than it looks: the signed token is `{resourceId, exp}` scoped
to one arbitrary UUID string, HMAC-derived from `BETTER_AUTH_SECRET` (no new deployment
secret). It happens to be called with an entry id today, but nothing about the signing/
verification pair is Entry-specific. **This is directly reusable for Page preview with zero
changes to `preview-token.ts` itself** — only a new route that resolves a Page by id/route
and calls the same `verifyPreviewToken`.

### 1.4 Public API caching (`apps/api/src/lib/public-cache.ts`)
Cloudflare Cache API only (no KV read-through tier yet — documented as deliberately deferred
scope). Cache keys are built against a fixed internal origin so they're stable across
custom-domain/workers.dev/local-dev hosts and reachable from the Cron sweep (no incoming
request to read a host from). Invalidation is explicit per-write (`invalidatePublicEntryCache`,
etc.), never left to passive TTL expiry, with a bounded/resumable queue (`cache_purge_jobs`)
for bulk purges exceeding Cloudflare's Free-plan subrequest budget. Structured Settings
(including Navigation) is **deliberately never edge-cached** — Cache API is per-colo, and
cross-colo staleness on low-traffic config wasn't worth the risk.

### 1.5 Contracts (`packages/contracts/schemas/`)
Consistent pattern: `enums.ts` holds every runtime-value array/const with zero zod import
(a tree-shaking constraint learned the hard way — a bundle leak once happened from mixing
enum arrays with `z.object()` in one file); `ROLE_RANK`/`roleAtLeast()` live here too. Each
domain file exports a response schema, `createX`/`updateX` request schemas, and inferred TS
types. `createOpenApiApp()` (`apps/api/src/lib/openapi.ts`) is the one factory every route
file uses so OpenAPI docs and validation-error shape stay uniform.

### 1.6 Plugin platform (`packages/plugin-sdk/`, `apps/api/src/plugins/`)
`PluginContext`/`PluginPublicContext` expose `db, user?, hasRole?, media, config, events,
email, payments, logger` — a deliberately generic capability surface. Mounting is static at
cold start (`app.route(...)` for every *manifest-valid* plugin) but gating is live and
per-request (`requirePluginEnabled`, DB-backed, checked before `requireSession`, 404s a
disabled plugin indistinguishably from "never installed"). Admin nav/pages for a plugin live
in `apps/admin/src/plugins/<id>/`, **not** inside the plugin's own npm package — because
`apps/admin` must stay independently deployable against a *published* `@kenresoft-cms/
contracts`, never a `workspace:*` link to an unpublished plugin package. Commerce is the one
existing precedent for a plugin at this schema/route/admin-UI scale.

### 1.7 Astro integration (`integrations/astro/`, `examples/astro-site/`)
The client SDK today is a thin, typed fetch wrapper: `entries.{list,get,preview}`,
`media.{url,get}`, `forms.submit`, `globalVariables.list`, `settings.<module>()`. No
content-type-discovery endpoint, no batch reference-resolution (the example site resolves a
`reference` field by fetching the *entire* target content type's list and finding the id
client-side — an accepted N+1-shaped gap, not yet a problem at this scale). Critically,
`examples/astro-site` already made the exact decision this project is asking for at page
scope: it moved from static output (`getStaticPaths()`, rebuild-to-see-changes) to full SSR
specifically so CMS changes appear without a rebuild — **dynamic, per-request rendering
against the live API is an already-proven pattern in this codebase**, not a new risk.

### 1.8 Navigation
No separate feature — it's a Structured Settings module (§1.1). Its `url` field is free
text today, not a reference to any content resource, which is the one real gap a Pages
system creates: an admin adding "Home" to the nav has no way to *reference* a Page by id,
only to type its URL by hand.

### 1.9 Admin UI patterns
Two directly reusable idioms recur across this codebase and are the strongest existing
precedent for how Pages/Blocks admin UI should be built:
- **Generic field rendering**: `apps/admin/src/components/field-input.tsx` dispatches on a
  `FieldType` union to one of ~8 typed field components (falling back to a plain input) —
  this is exactly the "renderer registry keyed by type" shape §8/§28 of the brief asks for,
  already built, just not yet abstracted into a registry object (it's an `if/else if` chain).
- **Flat registry-array + render-function**: `apps/admin/src/pages/settings/sections.tsx`
  (`SETTINGS_SECTIONS: {id, label, icon, group, available, render}[]`) and `apps/admin/src/
  plugins/registry.ts` (`pluginNavItems`) are both this same idiom, and the plugin registry's
  own comment explicitly says it mirrors the settings one. **A Block Type registry and a
  Template registry should follow this exact convention**, not invent a new one.

### 1.10 RBAC (`packages/contracts/schemas/enums.ts`)
`ROLE_RANK = {viewer:0, author:1, editor:2, admin:3, owner:4}`, `roleAtLeast()`. Every
existing `requireRole(...)` call site passes a contiguous top slice of the hierarchy. Media/
entries/forms/content-type-fields already sit at the `editor` floor; structural/user/settings
work sits at `admin`. This maps cleanly onto Pages/Templates (see §7).

### 1.11 Migrations
35 SQL migrations, `drizzle-kit generate` against `packages/database/schema/index.ts`,
applied via `wrangler d1 migrations apply`. A Pages/Blocks schema addition is just more files
in this same pipeline — no new tooling needed.

---

## 2. Target architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          KENRESOFT CMS (Core)                          │
│                                                                        │
│  EXISTING (unchanged):        NEW (this feature):                     │
│  Content Types / Fields       Pages                                   │
│  Entries / Revisions          Page Revisions                          │
│  Media                        Reusable Blocks                         │
│  Forms / Submissions          Templates                               │
│  Structured Settings ─────────▶ Navigation items MAY reference a Page │
│  Global Variables             Field `presentation` metadata (JSON)    │
│  Webhooks / Audit Log         Route registry (content types + pages)  │
│  RBAC / Plugin platform       Block Type registry (code-defined)      │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ public API (existing pattern:
                                    │ edge-cached, invalidated on write,
                                    │ draft ≡ nonexistent)
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    @kenresoft-cms/astro (extended)                    │
│  EXISTING: entries/media/forms/globalVariables/settings clients       │
│  NEW: pages.resolve(route) · pages.preview() · block renderer registry│
│       · field renderer registry (extends existing FieldInput idea)    │
│       · <PageRenderer>/<BlockRenderer> Astro components                │
└───────────────────────────────────┬───────────────────────────────────┘
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     ASTRO FRONTEND (SSR, per-request)                 │
│  [...slug].astro catch-all → resolveRoute() → Page or Entry match     │
│  Developer overrides via registerBlockRenderer(type, Component)        │
└───────────────────────────────────────────────────────────────────────┘
```

**Nothing existing is removed or renamed.** Mode A (fully headless, ignore all of this) and
today's Content Types/Entries workflow keep working with zero code changes — this is
additive, opt-in per deployment (see §12, backward compatibility).

---

## 3. Database / entity model (new tables)

All new tables live in Core (`packages/database/schema/`), **not** as a plugin — rationale
in §14. Naming/conventions match existing tables exactly (uuid text PKs, `createdAt`/
`updatedAt` as unix seconds unless noted, cascade deletes matching parent-entity ownership).

### 3.1 `pages`
```
id            text PK
route         text UNIQUE     -- e.g. "/", "/about", "/services/design" — leading slash,
                                  no trailing slash except root; validated against a reserved-
                                  path list (see §11) and against content-type route patterns
                                  for collisions at write time
title         text
status        text            -- reuses ENTRY_STATUSES ('draft'|'published') — same enum,
                                  not a new one
publishAt     integer (nullable) -- reuses the existing scheduled-publish sweep verbatim
templateId    text FK -> templates (nullable) -- nullable = ad-hoc composition, no template
blocks        text (JSON)     -- the page's own block composition tree (see §3.3 for shape)
seo           text (JSON)     -- {title?, description?, ogImageMediaId?, noindex?, canonical?}
                                  mirrors the shape already used by structured-settings' `seo`
                                  module for consistency, but page-scoped (per-page overrides
                                  the site-wide default)
createdBy     text FK -> user (nullable, set null)
createdAt / updatedAt   integer (timestamp_ms, matches entries' subsecond precision)
```
Index: unique on `route`. `data`/content fields deliberately absent — a Page is composition,
not authored content; content lives in Entries/Blocks, referenced from the tree.

### 3.2 `page_revisions`
Exact structural mirror of `entry_revisions` (`pageId` FK cascade, snapshot of `title/status/
blocks/seo`, `createdBy`, `createdAt`) — same write-before-every-change discipline, same
restore semantics, reusing `apps/api/src/routes/admin/entries.ts`'s revision code path as a
template rather than writing a second implementation from scratch.

### 3.3 Block composition shape (stored inline as `pages.blocks` JSON, not a separate table)
```ts
type BlockInstance = {
  id: string;              // stable per-instance id (for editing/reordering, not global identity)
  type: string;            // registered block type, e.g. "hero", "richText", "reusableBlockRef"
  config: Record<string, unknown>;  // validated against that block type's own Zod schema
  children?: BlockInstance[];       // only for block types declaring `allowsChildren`
};
// pages.blocks = { blocks: BlockInstance[] }
```
**Decision: JSON tree on the Page row, not a normalized `page_blocks` table.** Rationale:
identical to how Entries already store `data` as an untyped JSON blob validated at the API
layer — blocks are never queried relationally (no "find all pages using block type X" query
is in scope for Phase 1-4), and a JSON tree makes revisioning trivial (one column, already
covered by `page_revisions`' snapshot). Reordering/nesting/duplication (§19) all become
plain JSON tree operations in the admin UI, not SQL. If a future phase needs relational
block queries, that's a normalization migration at that point — not a speculative table now
(this repeats the project's own standing "don't build for a hypothetical" rule, and mirrors
why `entries.data` was never normalized either).

### 3.4 `reusable_blocks`
```
id          text PK
name        text            -- admin-facing label, e.g. "Global CTA"
type        text            -- one BlockInstance type, config validated the same way
config      text (JSON)
createdAt / updatedAt
```
A page references one via a `{type: "reusableBlockRef", config: {reusableBlockId}}` node in
its own tree. **Decision: live reference, not a copied snapshot** (per the brief's explicit
request to document this choice) — a reusable block is edited in exactly one place and every
page embedding it reflects the change immediately, matching the product intent in §16 of the
brief ("all references should use the new published version"). The cost is documented in
§9 (cache invalidation): changing a reusable block invalidates every page's cache
conservatively (a full Pages-namespace purge) rather than tracking per-page usage — accepted
as a bounded, low-frequency operation (reusable blocks change far less often than page content).

### 3.5 `templates`
```
id                text PK
name              text
contentTypeId     text FK -> content_types (nullable) -- null = general-purpose page template
blocks            text (JSON)     -- default BlockInstance[] tree, copied into a new Page/entry
                                      render on creation (never live-linked — a template is a
                                      starting point, not a reusable_block-style live reference)
isDefault         boolean
createdAt / updatedAt
```
Templates back the brief's §17 ask cleanly: creating a new Page (or rendering a content-type
entry that has no page of its own — see §5) can pre-fill from a template. Deliberately *not*
theme-provided defaults + admin overrides (WordPress Site Editor's two-tier model) in Phase 1
— every template here is admin-editable data from day one, since there's no separate
"theme" concept in this architecture yet. Revisit if/when a marketplace of installable
templates becomes a real goal (out of scope now, not silently foreclosed).

### 3.6 `field_definitions.presentation` (new nullable column, not a new table)
```
presentation   text (JSON, nullable)   -- {renderer?, format?, label?, displayMode?, variant?, alignment?}
```
Additive, backward-compatible (`null` = infer default renderer from `fieldType`, exactly
matching `field-input.tsx`'s current dispatch behavior). This directly satisfies §9 of the
brief: data schema (`fieldType`, `required`, `config`) stays untouched; presentation is a
parallel, optional column that a frontend renderer registry consults but the API/validation
layer never depends on.

### 3.7 Navigation extension (no schema change — a contracts/UI change only)
`structured-settings.ts`'s `navigationItemSchema` gains an optional `pageId` alternative to
`url` (`{label, order, visible, external, newTab} & ({url: string} | {pageId: string})`) —
resolved to the Page's `route` at render time by the Astro SDK. This is a contracts-schema
change, not a DB migration (the column is already a JSON blob). Existing nav data
(`url`-only entries) keeps working unmodified — no backfill needed.

### What does NOT get a new table
- **Route registry**: computed at request time from `pages.route` (exact match) plus each
  content type's own (new, optional) `routePattern` column — not a separately materialized
  table. A materialized route index is a caching concern (§9), not a source-of-truth concern.
- **Block Type registry**: code-defined (a manifest object per block type, like field types
  are a TS union today), not database rows — consistent with "don't let admins define
  arbitrary renderer behavior" (§32 security: a block type is a trusted, developer-registered
  component; its *content* is admin-authored, its *behavior* is not).

---

## 4. API changes

### 4.1 New admin routes (`apps/api/src/routes/admin/pages.ts`, mirroring `entries.ts`)
```
GET    /api/v1/admin/pages                  list (status/route filters)
POST   /api/v1/admin/pages                  create
GET    /api/v1/admin/pages/:id
PATCH  /api/v1/admin/pages/:id
DELETE /api/v1/admin/pages/:id
GET    /api/v1/admin/pages/:id/revisions
POST   /api/v1/admin/pages/:id/revisions/:revisionId/restore
GET    /api/v1/admin/pages/:id/preview-token     -- reuses signPreviewToken() verbatim
```
Role gate: `requireRole('admin','editor')` for write (structural, matches content-type-field
floor, not the looser entries floor — a Page's composition is closer to structure than to
day-to-day content); reads open to any authenticated non-viewer role, matching entries.

```
GET    /api/v1/admin/templates
POST   /api/v1/admin/templates
GET    /api/v1/admin/templates/:id
PATCH  /api/v1/admin/templates/:id
DELETE /api/v1/admin/templates/:id

GET    /api/v1/admin/reusable-blocks
POST   /api/v1/admin/reusable-blocks
GET    /api/v1/admin/reusable-blocks/:id
PATCH  /api/v1/admin/reusable-blocks/:id
DELETE /api/v1/admin/reusable-blocks/:id
```
Same `admin`/`editor` floor as Pages.

### 4.2 New public routes (`apps/api/src/routes/public/pages.ts`)
```
GET /api/v1/public/pages                 -- list published pages (id, route, title only —
                                              for sitemap generation; never full block trees
                                              in the list response, matching content.ts's
                                              own list-vs-detail shape distinction)
GET /api/v1/public/pages/by-route?route=/about
                                          -- resolve one page by its exact route; 404 for a
                                              draft is identical to 404 for a nonexistent
                                              route, same convention as content.ts
GET /api/v1/public/preview/pages?route=...&token=...
                                          -- mirrors routes/public/preview.ts exactly, reusing
                                              verifyPreviewToken() with the Page's id as the
                                              expected resourceId; never edge-cached, same
                                              reasoning as entry preview
```
Mounted in `index.ts` in the same position as the other named public mounts — **before** the
generic content catch-all, same ordering discipline as `forms`/`media`/`global-variables`.

`GET /api/v1/public/pages/by-route` (query param, not a path param) is deliberate: a route
can contain slashes (`/services/design`), and Hono path params don't cleanly capture an
arbitrary-depth segment without a wildcard route that would then compete with the
content-type catch-all's own wildcard — a query param sidesteps that ambiguity entirely
rather than fighting Hono's router for `/pages/*route`.

### 4.3 Content-type extension: optional `routePattern`
A new nullable `content_types.routePattern` column (e.g. `/blog/{slug}`) lets the route
resolver (SDK-side, §6) recognize `/blog/my-post` as "resolve via the `blog` content type's
existing `GET /api/v1/public/blog/my-post`" without a page ever being created for it — this
is what makes Scenario 1 in the brief ("Admin creates Blog content type → post appears at
/blog/my-post with zero Astro changes") actually work end-to-end, not just for Pages.
Collision with a literal `pages.route` is rejected at write time (creating/renaming a Page
or setting a `routePattern` checks the other table).

### 4.4 No breaking change to any existing route
Every existing public/admin route keeps its exact current shape. `entries.list/get` remain
independently useful for pure headless consumers who never adopt Pages at all (§12).

---

## 5. Frontend SDK design (`@kenresoft-cms/astro`)

New additions, alongside (never replacing) the existing client surface:

```ts
client.pages.list()                          // GET /public/pages
client.pages.resolve({ route })              // GET /public/pages/by-route
client.pages.preview({ route, token })       // GET /public/preview/pages

registerFieldRenderer(fieldType, Component)  // extends the existing implicit FieldInput idea
registerBlockRenderer(blockType, Component)  // developer override point, §26 of the brief
resolveRoute(pathname): Promise<
  | { kind: 'page', page: Page }
  | { kind: 'entry', contentType: string, entry: Entry }
  | { kind: 'notFound' }
>
```

`resolveRoute()` is the one new piece of real logic: it tries an exact `pages.resolve()`
match first, then checks each content type's `routePattern` (fetched once, cached client-
side per request lifetime — not per-request-to-CMS) for a parameterized match, returning a
discriminated result the catch-all Astro route switches on. This is deliberately a **client-
side (SDK) concern, not a new CMS API endpoint** — the CMS doesn't need to know Astro's own
routing; it only needs to answer "does a page exist at this route" and "does a content type
claim this pattern," both of which already exist as of §4.

`examples/astro-site` gets one new file, `src/pages/[...route].astro`, using `resolveRoute()`
+ `<PageRenderer page={page} />` for the `page` case, falling back to the *existing*
`blog/[slug].astro`-style per-content-type pages for any content type that hasn't opted into
generic routing — i.e., **hybrid mode (§7 of the brief) is the natural default**, not a
special case requiring extra plumbing.

`<PageRenderer>`/`<BlockRenderer>` (new `integrations/astro/src/render/` module): walk a
Page's `blocks` tree, resolve each `BlockInstance.type` against the block renderer registry
(falling back to a small built-in set of core block components shipped with the SDK — Hero,
RichText, Image, CTA, Columns, Spacer — matching §13's example list without over-building),
and recurse into `children` for nesting-capable types.

---

## 6. Renderer architecture

Two independent registries, both following the flat-array-registry idiom already established
in this codebase (§1.9):

**Field renderer registry** — generalizes `field-input.tsx`'s existing `if/else if` chain
into an actual registry object `Record<FieldType, RendererComponent>`, seeded with the same
defaults that chain already implements, with `field_definitions.presentation.renderer`
(§3.6) as an optional override key. Two implementations needed: one in `apps/admin` (editing
UI — unaffected by this feature, kept exactly as-is), one new one in `@kenresoft-cms/astro`
(read-only display).

**Block renderer registry** — `Record<string, BlockComponent>`, seeded with a small built-in
set, extended via `registerBlockRenderer()`. Resolution order (must be documented per §26 of
the brief): a developer-registered renderer for a block type **always** wins over the SDK's
built-in default for that same type — last-registration-wins is NOT the rule; explicit
override always beats built-in default, checked by type name, not registration order (avoids
surprise if a developer's `astro.config`/integration setup happens to run twice).

---

## 7. Security model

Extending the existing checklist (§32 of the brief) against what's already true here:

- **Tenant/project isolation**: N/A — this is single-site-per-deployment already (§11 of
  `ARCHITECTURE.md`); no change.
- **RBAC**: Pages/Templates/Reusable Blocks write-gated at `admin`/`editor`, same floor as
  content-type field management — a Page's composition is structural, not day-to-day
  editorial content, matching how field CRUD is already gated above plain entry writes.
- **Draft leakage**: the public Pages route reuses `content.ts`'s exact 404-parity
  convention — no new leakage surface.
- **Preview-token security**: reuses the existing, already-audited `preview-token.ts`
  unmodified — entry-scoped signing generalizes to page-scoped with zero code change to the
  signing/verification functions themselves (§1.3).
- **Arbitrary HTML injection / XSS**: a block's `config` is admin-authored JSON rendered
  through **trusted, developer-registered components** — same trust model as rich-text's
  existing `dangerouslySetInnerHTML`/`set:html` boundary (only an authenticated editor/admin
  can reach it), not raw admin-supplied markup interpreted as a template. A future "raw
  HTML" block type (if ever added) would need the same link-protocol-style hardening the
  rich-text editor already applies (`javascript:` URI rejection) — flagged as a Phase 3+
  decision, not built speculatively now.
- **Template injection / arbitrary code execution**: categorically impossible by
  construction — a Template/reusable Block is *data* (a JSON tree naming registered block
  types), never code. An admin can never introduce a block type the developer hasn't
  registered; they can only configure instances of types that already exist. This is the
  direct answer to §32's CRITICAL requirement.
- **Route injection / reserved paths**: `pages.route` writes are validated against a reserved
  list (`/api`, `/admin` if the Astro app ever proxies it, any framework-internal path
  prefix) at the API layer, not just trusted from the admin UI.

---

## 8. Caching & invalidation strategy

Follows the existing `public-cache.ts` pattern exactly, extended with two new invalidation
functions in that same file:

- `invalidatePublicPageCache(route)` — deletes the list key and the by-route key for that
  one page, called from every Page write route and the scheduled sweep (reusing the pattern
  `invalidatePublicEntryCache` already establishes).
- `invalidateReusableBlockCache()` — **conservatively purges the entire Pages cache
  namespace** (queued through the existing `cache_purge_jobs` mechanism if it exceeds the
  per-request subrequest budget) rather than tracking per-page usage of a given reusable
  block. Documented tradeoff (§3.4): correctness over precision, since reusable-block edits
  are expected to be rare relative to page/content edits.
- Page preview stays **never cached**, matching entry preview's existing reasoning exactly.

No new caching *layer* is introduced (still Cache-API-only, matching the project's own
already-stated "Workers KV out of scope until cross-colo consistency is an actual concern"
position) — this feature doesn't change that calculus.

---

## 9. Plugin integration strategy

Pages/Blocks/Templates ship in **Core**, not as a plugin (see §14 for the reasoning). Plugin
*extensibility into* this system is real but deliberately deferred to Phase 8 of the phased
plan (§13), matching the brief's own Phase 8 framing: a plugin should eventually be able to
contribute a block type or field-type renderer via a `PluginRegistration.blockTypes?`/
`fieldRenderers?` addition to the existing `PluginContext` surface (a small, additive change
to `packages/plugin-sdk`, following the exact precedent `publicRoutes`/`publicRateLimits`
already set as opt-in `PluginRegistration` fields) — not designed in detail here because
building it before a second real consumer exists would repeat the exact mistake this
codebase's own Workers-KV and generic-plugin-config decisions were explicitly written to
avoid (see CLAUDE.md's own standing rule against speculative extensibility).

---

## 10. Migration strategy

Additive only. New tables (`pages`, `page_revisions`, `reusable_blocks`, `templates`) via
normal `drizzle-kit generate` migrations. One new nullable column each on `field_definitions`
(`presentation`) and `content_types` (`routePattern`) — both `NULL`-default, zero backfill
required, zero behavior change for any existing row. The Navigation schema extension (§3.7)
is a contracts (Zod) change only, not a migration — existing `structured_settings` rows with
`url`-only nav items remain valid under the extended union type unmodified.

No existing table is altered destructively, renamed, or dropped.

---

## 11. Backward compatibility

- Every existing public/admin API route, response shape, and OpenAPI contract is unchanged.
- `@kenresoft-cms/astro`'s existing exports (`entries.*`, `media.*`, `forms.*`,
  `globalVariables.*`, `settings.*`) are unchanged — new exports are additive.
- A deployment that never creates a Page or Template sees **zero behavior change** anywhere:
  no new admin nav items render data that doesn't exist (empty-state UI only), no new public
  routes are ever hit by a frontend that doesn't call them, no existing cache key changes
  shape.
- `examples/astro-site` keeps its existing per-content-type page files working exactly as
  today; the new catch-all route is additive and only claims routes nothing else already
  handles.

---

## 12. Test strategy

Mirrors this codebase's own established verification discipline (real D1 in Vitest, then a
live `wrangler dev` pass, not just typecheck):
- New `apps/api/test/pages-routes.test.ts`, `page-revisions.test.ts`, `templates-routes.test.ts`,
  `reusable-blocks-routes.test.ts`, `public-pages.test.ts`, `pages-preview.test.ts` — following
  the exact structure of the equivalent Entries/Live-Preview test files (role gates, 404
  parity for drafts, revision/restore round trip, cache invalidation assertions).
- A route-collision test: creating a Page at a route a content type's `routePattern` would
  also match must 400, and vice versa.
- `apps/admin` page/component tests for the new Pages list/editor, Templates list, Reusable
  Blocks list, following existing `EntryEditorPage.test.tsx`-style coverage.
- A real end-to-end pass against `examples/astro-site` (per this project's own standing
  practice for every prior CMS feature): create a Page with a few blocks, confirm the
  catch-all route renders it, confirm a draft page 404s exactly like a nonexistent route,
  publish, confirm cache invalidation actually fires (not just that code compiles).

---

## 13. Phased implementation plan

Adopts the brief's own Phase 1-10 framing, sequenced against what's now known to already
exist (skipping/collapsing phases where Core already provides the primitive):

| Phase | Status | Scope | Depends on existing |
|---|---|---|---|
| **1** | **Done** (2026-09-12) | Field `presentation` metadata + a real field-renderer registry (admin + SDK) | `field-input.tsx`, `field_definitions` |
| **2** | **Done** (2026-09-12) | Content-type `routePattern` (exactly one `{slug}` param, per §14) + `resolveRoute()` in the SDK; no Pages yet, not wired into `examples/astro-site` | `content.ts` public route, entries |
| **3** | **Done** (2026-09-12) | `pages`/`page_revisions` tables, admin Pages CRUD + revision/restore, a small built-in block set, JSON-tree block composition editor (basic add/remove/reorder, not drag-and-drop yet), public Pages route, cache invalidation | Entries/revisions code path as template, `public-cache.ts` |
| **4** | **Done** (2026-09-12) | `reusable_blocks`, `templates` tables + admin UI; Page creation from a template | Phase 3 |
| **5** | **Done** (2026-09-12) | Page preview (reuses `preview-token.ts` verbatim) | Live Preview (already built) |
| **6** | **Done** (2026-09-12) | Navigation `pageId` reference option | Structured Settings navigation (already built) |
| **7** | **Done** (2026-09-14) | `resolveSiteRoute()` in the SDK, a developer-override block-renderer registry, `examples/astro-site`'s own `<PageRenderer>`/`<BlockRenderer>`/built-in block components + catch-all route | Astro SSR architecture (already proven) |
| **8** | **Done** (2026-09-14) | Drag-and-drop block editor (dnd-kit — already a dependency), duplicate/undo/redo | Phase 3 UI |
| **9** | Not started | Plugin-contributed block types (`PluginRegistration.blockTypes?`) | Plugin SDK, once a second real consumer exists |
| **10** | **Partially done** (hardening pass only, 2026-09-14) | ~~Patterns/presets~~ (still undesigned), production hardening pass (perf/security/cache re-verification — found and fixed a real cross-route data-loss bug, see §25) | All of the above |

Each phase ends with the same acceptance-test discipline as every other feature in this
codebase (§12) — no phase is marked done on compilation alone, matching this project's own
standing rule.

---

## 14. Open decisions — RESOLVED (see "§14 decisions — resolved" under Status above)

The three decisions below are kept for their original reasoning/context; the actual resolved
decisions (Core, one-`{slug}`-param routes, phased visual builder) are recorded once, near the
top of this document, so there's a single place a reader checks for "what was decided."

1. **Core vs. plugin.** Recommendation in this document is **Core**, because: (a) Pages/
   routing/preview/caching touch the same request path every existing public route already
   shares, and splitting that across a plugin boundary would mean either duplicating
   `public-cache.ts`'s logic or exposing internals the plugin SDK deliberately doesn't expose
   today (`PluginPublicContext` has no direct Cache API access); (b) unlike Commerce, this
   isn't a vertical a self-hosted CMS could reasonably ship without — it's closer to "how
   content becomes a website" than "an optional storefront add-on." A plugin-boundary
   alternative was considered and rejected for this reason, but this is ultimately a product
   decision, not a purely technical one — flagging rather than deciding unilaterally, per
   this project's own standing practice (see how the content-type-metadata-endpoint and
   multi-language questions were both left as open product decisions rather than resolved
   silently).
2. **Route pattern syntax** for `content_types.routePattern` (`{slug}` only vs. multiple
   params vs. optional segments) — Phase 2 needs this settled before the resolver ships.
3. **Whether v1 needs a visual drag-and-drop editor at all**, or whether a structured
   add/remove/reorder-by-buttons UI (matching Navigation's own deliberately simple move-up/
   move-down precedent, §1.8) is sufficient for an initial release — affects whether Phase 3
   or Phase 8 is the real "usable by a non-developer" milestone.

---

## 15. Files/modules expected to change (implementation-time reference)

```
packages/database/schema/pages.ts                      (new)
packages/database/schema/page-revisions.ts              (new)
packages/database/schema/reusable-blocks.ts              (new)
packages/database/schema/templates.ts                    (new)
packages/database/schema/field-definitions.ts             (+presentation column)
packages/database/schema/content-types.ts                 (+routePattern column)
packages/database/schema/relations.ts                     (+ new relations)
packages/database/schema/index.ts                         (+ re-exports)
packages/database/migrations/00xx_*.sql                   (generated)

packages/contracts/schemas/pages.ts                       (new)
packages/contracts/schemas/blocks.ts                      (new — BlockInstance, per-block-type config schemas)
packages/contracts/schemas/templates.ts                   (new)
packages/contracts/schemas/reusable-blocks.ts              (new)
packages/contracts/schemas/field-definitions.ts            (+presentation schema)
packages/contracts/schemas/structured-settings.ts          (navigationItemSchema union)
packages/contracts/schemas/enums.ts                        (+ block type names, if a fixed core set)

apps/api/src/routes/admin/pages.ts                        (new)
apps/api/src/routes/admin/templates.ts                     (new)
apps/api/src/routes/admin/reusable-blocks.ts                (new)
apps/api/src/routes/public/pages.ts                        (new)
apps/api/src/routes/public/preview.ts                       (extend, or a sibling pages-preview route)
apps/api/src/lib/public-cache.ts                            (+ page/reusable-block invalidation)
apps/api/src/index.ts                                       (+ mounts, ordered before content catch-all)

apps/admin/src/pages/PagesPage.tsx, PageEditorPage.tsx       (new)
apps/admin/src/pages/TemplatesPage.tsx                       (new)
apps/admin/src/pages/ReusableBlocksPage.tsx                  (new)
apps/admin/src/pages/settings/NavigationSection.tsx          (extend — page reference option)
apps/admin/src/routes/router.tsx                             (+ routes)

integrations/astro/src/index.ts                             (+ pages.*, registerBlockRenderer, resolveRoute)
integrations/astro/src/render/                               (new — PageRenderer, BlockRenderer, built-in blocks)
examples/astro-site/src/pages/[...route].astro                (new)

docs/ARCHITECTURE.md                                        (+ §, new entities documented alongside existing)
docs/ASTRO.md                                                (+ Pages/Blocks section)
docs/SITE_BUILDER.md                                         (this file — updated as phases land)
```

---

## 16. Risks & mitigations

- **Scope creep into a full page-builder before the foundation is proven.** Mitigated by the
  phased plan (§13) explicitly sequencing drag-and-drop, undo/redo, and plugin-contributed
  blocks *after* the basic CRUD + rendering loop is verified end-to-end.
- **Cache invalidation correctness under reusable blocks.** Mitigated by the deliberately
  conservative full-namespace-purge choice (§8) over an unproven fine-grained dependency
  tracker.
- **Route collision between Pages and content-type patterns.** Mitigated by explicit
  write-time collision checks in both directions (§4.3), tested directly (§12).
- **Divergence from the plugin SDK's existing capability surface** if Pages/Blocks
  extensibility is designed in isolation from `packages/plugin-sdk`. Mitigated by explicitly
  deferring plugin-contributed block types (§9) rather than half-building a second
  extensibility mechanism now.

---

## 17. Phase 1 — implementation record (2026-09-12)

**Done.** Field presentation metadata + a field-renderer registry, exactly as scoped in §3.6/
§6/§9 above and nothing more (no Pages/Templates/Reusable Blocks/routing/drag-and-drop).

- `packages/database/schema/field-definitions.ts` — new nullable `presentation` column;
  migration `0035_glorious_wendell_rand.sql` (additive, `ALTER TABLE ... ADD presentation
  text;`, no backfill).
- `packages/contracts/schemas/field-definitions.ts` — `fieldPresentationSchema` (`.strict()`,
  string-only keys: `renderer, format, label, displayMode, variant, alignment`), wired into
  `fieldDefinitionSchema`/`createFieldDefinitionSchema`/`updateFieldDefinitionSchema`.
- `apps/api/src/repositories/field-definitions.ts` + `apps/api/src/routes/admin/
  content-types.ts` — pass `presentation` through create/update/read, matching `config`'s
  existing handling exactly.
- `apps/admin/src/components/field-input.tsx` — the field-type `if/else if` dispatch chain
  became an explicit `FIELD_INPUT_REGISTRY` object; behavior-preserving refactor only (no
  admin UI was added to edit `presentation` — deliberately out of scope for this phase, since
  nothing in the Phase 1 requirements asked for it and there's no consumer for it in the admin
  editing flow yet).
- `integrations/astro/src/render/field-renderers.ts` (new) — `renderField()`,
  `resolveFieldRenderer()`, `registerFieldRenderer()`; a closed `FieldRenderResult` union
  (`text/html/number/boolean/date/link/image/relation/list/empty`) rather than raw markup, so
  a template decides how each kind renders. Re-exported from `integrations/astro/src/index.ts`.
- Tests: `apps/api/test/field-presentation.test.ts` (5 tests, real D1 — omitted/null/round-
  trip/invalid-key-rejected/unaffected-by-unrelated-update), `integrations/astro/test/
  field-renderers.test.ts` (17 tests, Node's own `--experimental-strip-types --test` runner —
  no bundler/HTTP surface needed for pure logic, a new but minimal test-infra addition for this
  one package), and the two pre-existing admin fixtures that construct a full `FieldDefinition`
  object (`field-input.test.tsx`, `generate-snippets.test.ts`) updated to include
  `presentation: null`.
- Docs: `docs/ARCHITECTURE.md` §6.3 (new) + Changelog v0.14; `docs/ASTRO.md` "Field rendering
  (Phase 1 of the schema-driven frontend work)" (new section); this file.

**Architectural decisions made during implementation** (none changed the Phase 0 plan; all
are implementation-level choices Phase 0 left open):
- Renderer **names are a separate namespace from `FieldType`** (e.g. `"richText"`, not
  `"rich_text"`) — lets one renderer serve several field types (`text` serves
  `text/textarea/slug/email/select`) and lets a custom `presentation.renderer` name never
  collide with a `FieldType` string by construction.
- The admin editing registry and the Astro display registry are **two separate registries**,
  not one shared abstraction — confirmed during implementation that they have genuinely
  different shapes (React components with `onChange` vs. pure data-in/data-out functions) and
  forcing a shared type would have added indirection with no real code reuse.
- `apps/admin`'s field editor **does not yet read `presentation.renderer`** at all — Phase 1's
  brief scoped the registry refactor as behavior-preserving, and there's no admin UI need for
  it yet (the editing widget for a field doesn't change based on how it will be *displayed*
  downstream). Revisit only if/when a concrete admin UI need appears.
- Chose Node's native `--experimental-strip-types --test` over adding Vitest to
  `integrations/astro` — this package has no HTTP surface, no DOM, and no existing test
  precedent to match; the pure-`node --test` pattern already exists in this repo for
  `scripts/lib`'s pure-function tests, so this follows an existing convention rather than
  introducing a new one. Node 22 (this repo's CI floor) supports the flag.

**Verification performed** (not compilation alone): `pnpm typecheck`/`pnpm lint` clean across
`packages/contracts`, `packages/database`, `integrations/astro`, `apps/admin`, `apps/api`;
`integrations/astro`'s new 17-test suite passing; `apps/api/test/field-presentation.test.ts`
(5 tests) plus the adjacent `field-reorder`/`admin-routes`/`entries-export-import`/
`api-docs-gate`/`health` suites (28 more tests) passing against real D1; `apps/admin`'s
`field-input.test.tsx`/`generate-snippets.test.ts` passing directly, and the four test files
that showed transient 5000ms timeouts under one full concurrent 32-file run confirmed to pass
cleanly in isolation immediately after (this repo's own documented Windows/workerd resource-
contention flakiness pattern, not a regression from this change); `examples/astro-site`'s
`astro check` (0 errors) and `astro build` (succeeds) re-run clean, confirming the existing
Astro example is unaffected.

**No breaking changes**: every existing public/admin API response shape is unchanged except
one new nullable field (`presentation`) on `FieldDefinition`; no existing entry, field
definition, or Astro integration behavior changed for any field that doesn't set
`presentation`.

## 18. Phase 2 — implementation record (2026-09-12)

**Done.** Content-type `routePattern` (exactly one required `{slug}` param, per §14 decision
#2) + `resolveRoute()`/`matchRoutePattern()` in `@kenresoft-cms/astro`. Nothing beyond this
scope: no Pages, no wiring into `examples/astro-site`.

- `packages/database/schema/content-types.ts` — new nullable `routePattern` column plus a
  unique index (`content_types_route_pattern_unique` — a unique index over a nullable column
  allows any number of `NULL`s, so content types without a route never collide with each
  other); migration `0036_right_stardust.sql`.
- `packages/contracts/schemas/routing.ts` (new) — `routePatternSchema` (shape validation: one
  `{slug}` at the pattern's end, lowercase-hyphenated literal segments, reserved-prefix
  rejection) and `RESERVED_ROUTE_PREFIXES` (`packages/contracts/schemas/enums.ts`: `api`,
  `admin`). `packages/contracts/schemas/route-patterns.ts` (new) — the public listing's
  response schema, with an explicit doc comment distinguishing it from the still-unresolved
  "public content-type metadata" question.
- `apps/api/src/repositories/content-types.ts` — `getContentTypeByRoutePattern()` (the API-
  layer pre-write collision check, alongside the DB's own unique index) and
  `listContentTypesWithRoutePattern()`. `apps/api/src/routes/admin/content-types.ts` — create/
  update both 400 on a route-pattern collision (with a same-value no-op exception on update, so
  re-saving a content type's own unchanged pattern never false-positives) and invalidate the
  new public cache entry when a pattern actually changes.
- `apps/api/src/routes/public/route-patterns.ts` (new) — `GET /api/v1/public/route-patterns`,
  edge-cached and invalidated the same way `global-variables` is; mounted in `index.ts` before
  the content catch-all, same ordering discipline as every other named public route.
- `integrations/astro/src/render/resolve-route.ts` (new) — `matchRoutePattern()` (pure segment
  comparison, `{slug}` always the pattern's final segment by construction) and `resolveRoute()`
  (returns `{kind:'entry', contentTypeSlug, slug} | {kind:'notFound'}`, a discriminated union
  deliberately shaped so a `page` variant can be added later without breaking callers).
  Re-exported from `integrations/astro/src/index.ts`, alongside a new `client.routePatterns.
  list()` method.
- `apps/admin`: `ContentTypeDetailPage.tsx`'s existing `EditContentTypeDialog`/`ContentTypeForm`
  gained a "Route pattern" field (optional text input, blank → `null`) — the one piece of admin
  UI this phase needed, since without it there'd be no way for an admin to actually set a
  content type's route short of a raw API call. Deliberately reused the existing edit form
  rather than adding a new dialog/page.
- Tests: `apps/api/test/content-type-route-pattern.test.ts` (6 tests, real D1 — one covers
  valid-pattern acceptance/round-trip, one loops through every disallowed shape and reserved
  prefix, one covers create/update collision detection plus the same-value exception, one
  covers clearing a pattern freeing it for reuse, and two cover the public listing's filtering/
  sorting/no-session-required behavior) and `integrations/astro/test/resolve-route.test.ts`
  (13 tests — exact-match/root-pattern/multi-segment-prefix matching, non-matches, an
  empty-slug trailing-slash rejection, URL-decoding, and `resolveRoute()`'s order-independence).
  `apps/admin/test/ContentTypeDetailPage.test.tsx` gained two cases for the new field (a
  successful save, and the server's collision error surfacing in the dialog).

**Architectural decisions made during implementation:**
- **A dedicated, narrow public endpoint** (`route-patterns`) rather than either (a) reusing/
  extending the still-unresolved content-type-metadata question, or (b) requiring a developer
  to hardcode route patterns client-side. Justified because a route pattern discloses
  categorically less than a field list — it's a URL shape, not internal content-modeling
  structure — so building it doesn't quietly resolve the bigger, deliberately-deferred
  question by a side door.
- **`resolveRoute()` returns identity only (`contentTypeSlug`/`slug`), not the fetched entry**
  — keeps the function pure and testable with no network dependency; the caller composes it
  with the existing `entries.get()`.
- **A real test-infrastructure bug found and fixed while writing the first draft of this file's
  tests**: an initial version shared one signed-up admin session across many `it()` blocks
  (via `beforeAll`, or via a module-scoped memoized cookie) to stay under `AUTH_RATE_LIMITER`'s
  10 POST/60s budget — this passed when run in isolation but hung or failed with spurious 401s
  once more than one test ran in the same file. Root cause, confirmed by bisecting with `-t`
  filters: `@cloudflare/vitest-pool-workers`' default `isolatedStorage: true` resets D1
  (including the `session`/`user` tables) to a fresh snapshot **between every single `it()`**,
  not just between files — a cookie obtained in one test's body is already stale by the next
  test, even though the rate limiter's own binding state (confirmed separately) *does* persist
  file-wide regardless. The fix was neither `beforeAll` nor cross-test cookie reuse, but
  consolidating each collision/validation scenario group into one `it()` that does exactly one
  real sign-up and then exercises several assertions sequentially within that single test's
  body (D1 state *is* shared across requests within one test) — 5 sign-ups (10 POSTs) for the
  whole file instead of ~18, and no cross-test state assumption at all. Worth recording since
  the closest existing precedent in this codebase (`commerce-customer-auth.test.ts` et al.)
  already avoids this exact trap by never sharing a session across `it()` blocks either, but
  the *reason* — per-test isolated storage, not merely "fresh state is tidier" — wasn't spelled
  out anywhere before now.
- **Admin UI added, unlike Phase 1's `presentation`** — because without it, setting a route
  pattern would require a raw API call; Phase 1's field-presentation metadata had no such
  gap (no admin workflow needs to set it yet).

**Verification performed**: `pnpm typecheck`/`pnpm lint` clean across `packages/contracts`,
`packages/database`, `apps/api`, `apps/admin`, `integrations/astro`; all new tests passing,
run for real (not just written) — 6 API + 13 SDK + 2 admin; the pre-existing
`ContentTypeDetailPage.test.tsx`/`ContentTypesPage.test.tsx`/`generate-snippets.test.ts` suites
re-run clean after the `ContentType` type gained `routePattern`.

**No breaking changes**: every existing public/admin API response shape is unchanged except
one new nullable field (`routePattern`) on `ContentType`; a deployment that never sets a
route pattern sees zero behavior change anywhere, including an empty (not different-shaped)
`route-patterns` public response.

## 19. Phase 3 — implementation record (2026-09-12)

**Done.** The `pages`/`page_revisions` data model, admin Pages CRUD with revision history/
restore, a small code-defined built-in block set with per-type config validation, a basic
add/remove/reorder block-composition editor, the public Pages API, and route-collision checks
in both directions between Pages and content-type route patterns — exactly the scope in §13's
table and nothing more (no Templates, Reusable Blocks, Page preview, Navigation `pageId`
reference, or Astro rendering — all deliberately deferred to Phases 4-7).

- `packages/database/schema/pages.ts`/`page-revisions.ts` (new) — `pages` (`route` unique,
  `title`, `status`/`publishAt` reusing `ENTRY_STATUSES` and the scheduled-publish sweep
  verbatim, `blocks` JSON, nullable `seo` JSON, `createdBy`); `page_revisions` (an exact
  structural mirror of `entry_revisions`). Deliberately **no `templateId` column yet** —
  Templates ship in Phase 4; adding that FK then is itself an additive nullable column, per
  this project's own "additive only" migration convention, not something this table needs to
  anticipate now. Migration `0037_curly_lucky_pierre.sql` (two new tables, zero changes to any
  existing table).
- `packages/contracts/schemas/blocks.ts` (new) — `BlockInstance`/`ChildBlockInstance` types,
  `blockInstanceSchema`, one Zod config schema per built-in block type
  (`BLOCK_CONFIG_SCHEMAS`), and `validateBlockTree()` (the API-layer walk `blockInstanceSchema`
  alone can't do: each node's `config` must match its own type's schema, and only `columns` may
  carry `children` at all). `packages/contracts/schemas/enums.ts` gained `BLOCK_TYPES`
  (`hero`, `richText`, `image`, `cta`, `columns`, `spacer` — §5's example list, not
  over-built) and `BLOCK_TYPES_ALLOWING_CHILDREN` (`columns` only).
  `packages/contracts/schemas/pages.ts`/`page-revisions.ts` (new) — `pageSchema`/
  `createPageSchema`/`updatePageSchema`/`pageListItemSchema`/`pageRevisionSchema`, plus
  `pageSeoSchema` (mirrors structured-settings' own `seo` module shape, page-scoped).
  `packages/contracts/schemas/routing.ts` gained `pageRouteSchema` (a literal route — no
  `{slug}`, unlike a content-type `routePattern`) and `doesRoutePatternMatchLiteralRoute()`
  (the shared collision-check primitive both directions use).
- `apps/api/src/repositories/pages.ts` (new) — CRUD, revision snapshot/restore, and
  `publishDuePages()`, mirroring `repositories/entries.ts` structurally throughout; plus
  `findPageMatchingRoutePattern()` for the reverse collision direction.
  `apps/api/src/routes/admin/pages.ts` (new, `admin`/`editor` write floor — matching the
  content-type-field floor, not the looser entries floor, since a Page's composition is
  structural). `apps/api/src/routes/public/pages.ts` (new) — list (id/route/title only) and
  by-route (a query param, not a path param, since a route can contain slashes), reusing
  `routes/public/content.ts`'s exact draft-is-nonexistent 404 convention and edge-cache
  pattern. `apps/api/src/lib/public-cache.ts` gained `invalidatePublicPageCache()`.
  `apps/api/src/routes/admin/content-types.ts`'s existing route-pattern collision check gained
  the reverse direction (`findPageMatchingRoutePattern`). `apps/api/src/index.ts` mounts both
  new route files (before the content catch-all, same ordering discipline as every other named
  public mount) and extends the scheduled-publishing Cron handler to also call
  `publishDuePages()` and queue cache purges for any Page it auto-publishes.
- `apps/admin`: `apps/admin/src/pages/blocks/block-registry.ts` (new) — a flat registry array
  (`BLOCK_TYPE_REGISTRY`) driving a generic per-block-type config form, following this
  codebase's own established "flat registry-array + render-function" idiom (§1.9) rather than
  inventing per-block-type components. `apps/admin/src/pages/blocks/BlockTreeEditor.tsx` (new)
  — add/remove/move-up/move-down buttons at the top level and, for `columns` blocks, one level
  of nested children; a controlled `(blocks, onChange)` component so a future Phase 8
  drag-and-drop editor can replace it without touching the Page/Block data model at all (§14
  decision #3's explicit requirement). `apps/admin/src/pages/PagesPage.tsx`/
  `PageEditorPage.tsx` (new) — a list+create-dialog page mirroring `FormsPage.tsx`'s own shape,
  and an editor with title/route/status fields, the block tree editor, a revision-history
  panel with restore, and a delete confirmation. Registered in `router.tsx`, `AppLayout.tsx`'s
  Content nav group, and the command palette.
- Tests: `apps/api/test/pages-routes.test.ts` (3 tests, real D1 — CRUD + block-tree validation
  + nesting-on-a-leaf rejection, route collisions in both directions including the same-value
  no-op exception, revision snapshot/restore) and `apps/api/test/public-pages.test.ts` (2
  tests — list/by-route, draft-vs-nonexistent 404 parity, empty-list default).
  `apps/admin/test/BlockTreeEditor.test.tsx` (6 tests) and `apps/admin/test/PagesPage.test.tsx`
  (3 tests).

**Architectural decisions made during implementation:**
- **The block tree is capped at two tiers, not truly recursive.** The first draft used a
  self-referential `z.lazy()` schema for `blockInstanceSchema` — this crashed
  `GET /api/v1/openapi.json` outright (a 500, confirmed by temporarily wiring an `onError`
  handler to see the real failure): `@hono/zod-openapi`'s document generator can't serialize a
  self-referential schema from a plain (non-`@hono/zod-openapi`) zod instance without
  infinitely expanding it. Fixed by capping the type at exactly two tiers (a block, and that
  block's own non-nesting children) — every built-in block type in this phase only ever needs
  one level of nesting (`columns` holding simple children), so no product capability was lost;
  revisit only if a future block type genuinely needs deeper nesting.
- **No `templateId` column on `pages` yet**, even though §3.1's original design included one —
  Templates don't exist until Phase 4, and a nullable FK to a not-yet-existing table can't be
  added now anyway. Adding it in Phase 4 is itself a trivial additive migration.
- **Collision checking is a full table scan in both directions** (`findPageMatchingRoutePattern`
  scans every Page; the reverse direction scans every content type with a route pattern) rather
  than a smarter indexed lookup — consistent with this codebase's own accepted scale
  assumptions elsewhere (a self-hosted site's page/content-type count is small), and mirrors
  the exact reasoning already applied to `isReservedRoutePattern`'s own simple checks.
  `doesRoutePatternMatchLiteralRoute()` lives in `packages/contracts/schemas/routing.ts`
  (not duplicated in two route files) since both `routes/admin/pages.ts` and
  `routes/admin/content-types.ts` need the identical shape-matching logic.
- **The admin editor's `PageEditorPage`/`BlockTreeEditor` avoid effect-based state syncing** —
  the first draft used `useEffect` to copy a loaded `Page` query result into local form state,
  which `eslint-plugin-react-hooks`'s new React Compiler rules flag (`react-hooks/set-state-in-
  effect`) as cascading-render-prone. Fixed by splitting into an outer loading-gate component
  and an inner `PageForm` that only mounts once `page` has loaded, initializing state via
  `useState`'s lazy form directly from the loaded value — the exact pattern
  `EntryEditorPage.tsx`'s own `EntryForm` already established for the same reason.

**Verification performed**: `pnpm typecheck`/`pnpm lint` clean across `packages/contracts`,
`packages/database`, `apps/api`, `apps/admin` (zero errors; lint's two new-code failures during
development — the recursive-schema OpenAPI crash and two React Compiler purity/effect rule
violations — were both root-caused and fixed, not suppressed). All new tests passing for real:
5 API tests + 9 admin tests. Regression batches re-run clean: `content-type-route-pattern`,
`entries-export-import`, `audit-log`, `admin-routes`, `public-routes`, `health`,
`api-docs-gate`, `scheduled` (which now also exercises `publishDuePages`), `cache-purge`,
`cache-routes`, `public-cache`, `public-content-rate-limit`, `public-media-routes`,
`field-reorder`, `repositories`, `role-permissions`, `forms-routes`, `global-variables-routes`,
`media-routes`, `settings-routes`, `structured-settings-routes`/`-public`/`-legacy-migration`,
`webhooks-routes`, `users-routes`, `plugin-registry`, `live-preview`, `auth-rate-limit` — 34
files, all green (individually/in small batches per this project's own standing Windows/
workerd-flakiness practice; two batches hit the documented module-fallback/zod-locale
resource-exhaustion pattern on a full-file run, confirmed non-code by re-running each file
alone or in smaller groups). The full `apps/admin` suite (34 files, 200 tests) was also run;
two pre-existing files (`SettingsPage.test.tsx`, `ContentTypeDetailPage.test.tsx`) hit this
project's own already-documented transient-timeout flakiness under one full concurrent run,
confirmed non-regression by passing cleanly in isolation immediately after.

**No breaking changes**: every existing public/admin API response shape is unchanged; two new
tables and zero changes to any existing table or column. A deployment that never creates a Page
sees zero behavior change anywhere — the scheduled sweep's new `publishDuePages()` call is a
no-op when no Page exists, and the new public routes return an empty list rather than erroring.

Per the same phase-gate discipline as Phases 1-2: stopped after Phase 3, pending explicit
approval before Phase 4 (`reusable_blocks`/`templates` tables + admin UI, Page creation from a
template) — not started.

## 20. Phase 4 — implementation record (2026-09-12)

**Done.** `reusable_blocks`/`templates` tables, admin CRUD for both, and Page creation from a
template — exactly §13's scoped items.

- `packages/database/schema/reusable-blocks.ts` (new) — `id`, `name`, `type` (a `BlockType`,
  restricted at the API layer), `config` (JSON). `packages/database/schema/templates.ts` (new)
  — `id`, `name`, nullable `contentTypeId` (FK, `onDelete: 'set null'` — deleting the content
  type doesn't delete the template, since its blocks/name stay meaningful as a general-purpose
  template afterward), `blocks` (JSON), `isDefault` (a plain boolean flag, deliberately with no
  uniqueness enforcement across a scope — matching this project's own "keep the first
  implementation intentionally simple" precedent; an admin can currently mark more than one
  template default within the same scope, an accepted simplification not a bug). `pages.ts`
  gained the `templateId` column §3.1 originally specified but Phase 3 deferred (Templates
  didn't exist yet) — exactly the trivial additive migration that record predicted. Migration
  `0038_faithful_black_knight.sql`: two new tables plus one new nullable FK column, zero changes
  to any existing column.
- `packages/contracts/schemas/enums.ts` — `BLOCK_TYPES` gained `reusableBlockRef` (a leaf block
  whose config is `{reusableBlockId}`, resolving to a *live* reference — never copied — at
  render time, §3.4) and a new `REUSABLE_BLOCK_TYPES` (the leaf, non-referencing subset a
  `reusable_blocks` row's own `type` is restricted to: never `columns` — this table has no
  column to store children in — and never `reusableBlockRef` itself, which would allow a
  reference chain a renderer would have to detect and break).
  `packages/contracts/schemas/blocks.ts` gained `REUSABLE_BLOCK_REF_CONFIG` (added to
  `BLOCK_CONFIG_SCHEMAS`, so `validateBlockTree()` needed no changes at all — the existing
  per-type dispatch already covers a new entry in that map). `packages/contracts/schemas/
  reusable-blocks.ts`/`templates.ts` (new) — response/create/update schemas.
  `packages/contracts/schemas/pages.ts` gained `templateId` on `pageSchema` and an optional
  `templateId` on `createPageSchema` (§4.3 below).
- `apps/api/src/repositories/reusable-blocks.ts`/`templates.ts` (new) — plain CRUD, no
  revisioning for either (not in §13's scope for this phase — reusable blocks are live
  references with no history concept yet, and templates are copied-once starting points, not
  something whose own edit history matters the way a Page's does).
  `apps/api/src/routes/admin/reusable-blocks.ts`/`templates.ts` (new), both `admin`/`editor`
  gated like Pages. `routes/admin/pages.ts`'s create handler: when `templateId` is given and the
  request's own `blocks` is empty/omitted, the template's blocks are copied in server-side
  (`blocks.length === 0` check) — explicit caller-supplied blocks always win over the template's
  default, and `templateId` is recorded on the page either way as bookkeeping (never a live
  link — editing the template afterward has zero effect on pages already created from it, §3.5).
  A `templateId` naming a nonexistent template 404s.
- **Cache invalidation for reusable blocks, exactly as §8/§16 already specified**: updating or
  deleting a reusable block conservatively purges the *entire* Pages cache namespace (the list
  key plus every page's own by-route key), queued through the existing `cache_purge_jobs`
  mechanism (`invalidateAllPageCaches()`, `routes/admin/reusable-blocks.ts`) rather than
  building an unproven per-page usage tracker — this route has no cheap way to know which pages
  actually embed a given reusable block, and reusable-block edits are expected to be rare
  relative to page edits.
- `apps/admin`: `pages/blocks/block-registry.ts` gained a `reusableBlockRef` entry (a
  `reusableBlock`-kind field) and a `reusableBlock` field kind in `BlockTreeEditor.tsx`'s
  generic config-field dispatch (a `<Select>` populated from `useReusableBlocks()`, showing each
  block's own name). `BlockConfigForm` was exported from `BlockTreeEditor.tsx` so
  `ReusableBlocksPage.tsx` could reuse the exact same per-type config form for a reusable
  block's own `{type, config}` pair instead of a second implementation.
  `pages/ReusableBlocksPage.tsx` (new) — list + create/edit dialog (name, a type `<Select>`
  restricted to `REUSABLE_BLOCK_TYPES`, the shared config form), no revision history (matches
  the API's own scope). `pages/TemplatesPage.tsx` (new) — list + create/edit dialog (name, a
  content-type scope `<Select>` with a "general-purpose" option, an `isDefault` checkbox, the
  full `BlockTreeEditor`). `PagesPage.tsx`'s existing "New page" dialog gained an optional
  "Start from a template" `<Select>` (rendered only once at least one template exists) that
  passes `templateId` through to the same `createPage` call Phase 3 already had. Registered in
  `router.tsx`, `AppLayout.tsx`'s Content nav group, and the command palette.
- Tests: `apps/api/test/templates-routes.test.ts` (2 tests, real D1 — CRUD, block-tree
  validation, content-type scoping) and `apps/api/test/reusable-blocks-routes.test.ts` (2 tests
  — CRUD, the `columns`/`reusableBlockRef` type restriction, and a cache-purge-job-queued
  assertion after an update). `apps/api/test/pages-routes.test.ts` gained a fourth test covering
  template-based page creation end to end: copying a template's blocks, a 404 on an unknown
  `templateId`, explicit request blocks overriding the template default, and confirming an
  already-created page is unaffected by a later template edit (never live-linked).
  `apps/admin/test/ReusableBlocksPage.test.tsx`/`TemplatesPage.test.tsx` (3 tests each) and a
  new case in `BlockTreeEditor.test.tsx` covering the `reusableBlockRef` field's picker.

**Architectural decisions made during implementation:**
- **A nested `ctx.waitUntil()` call inside an already-`waitUntil`'d function doesn't reliably
  drain before the outer one is considered settled** — found while writing the reusable-blocks
  cache-invalidation test, not assumed: the first version of `invalidateAllPageCaches()` called
  `ctx.waitUntil(processCachePurgeJobBatch(...))` from *inside* a function that was itself only
  ever invoked via the caller's own `ctx.waitUntil(...)`, and the test asserting the purge job
  reached `'completed'` status flaked between `'pending'` and `'completed'` depending on timing.
  Fixed by awaiting `processCachePurgeJobBatch()` directly inside the one outer `waitUntil`'d
  function instead of registering a second, nested one — the whole function's promise (enqueue
  *and* process) is what the caller's single `waitUntil()` actually waits on. Worth recording:
  this project's existing scheduled-publish sweep (`index.ts`) and webhook-retry code both use a
  similar "one `waitUntil` per logical background task" shape already, which is exactly why they
  never hit this — the bug only appears when a `waitUntil`'d function itself tries to hand off a
  *second* piece of async work to another `waitUntil` call rather than just awaiting it.
- **`isDefault` has no uniqueness enforcement across a scope** — a deliberate simplification,
  not an oversight: enforcing "at most one default per content type / per general scope" would
  need either a partial unique index (SQLite supports this, but scoping it correctly against a
  nullable `contentTypeId` needs care) or application-level unset-the-others-first logic on
  every write. Neither is justified yet since nothing in this phase actually *reads* `isDefault`
  to auto-select a template anywhere — it exists as admin-facing labeling only, wired up for the
  first time when a future phase actually needs to pick "the" default template for a scope.
- **No revision history for Templates or Reusable Blocks** — §13 never asked for it, and neither
  entity has the same "point-in-time published state" concept a Page or Entry does: a
  Template's content only ever matters at the moment a Page copies it, and a Reusable Block's
  current state *is* what every embedding page shows right now, with no separate "draft/
  published" distinction to revert between.
- **`templateId` is set-once at creation, not updatable via `PATCH /pages/:id`** — matching the
  bookkeeping-only nature described in §3.1/§3.5; nothing in this phase's scope needed to
  re-apply a different template's blocks to an already-existing page, and adding that now would
  be speculative.

**Verification performed**: `pnpm typecheck`/`pnpm lint` clean across every touched package
(two real issues surfaced and fixed during development, not suppressed: a `z.enum()` literal-
type loss from an over-eagerly-widened `REUSABLE_BLOCK_TYPES` annotation, and a DB-row-to-
contract-type narrowing gap for `ReusableBlock.type`). All new tests passing for real (4 new API
tests + 9 new admin tests, including the `pages-routes.test.ts` extension). Regression sweep:
the full `apps/admin` suite (36 files, 198 tests) in one clean run, and 25 pre-existing `apps/
api` test files (content-type-route-pattern, health, api-docs-gate, dashboard-routes, audit-log,
admin-routes, scheduled, cache-purge, cache-routes, entries-export-import) — all green
individually (a batched run hit this project's own already-documented Windows/workerd module-
resolution resource-exhaustion flakiness, confirmed non-regression by re-running each file alone
immediately after, all clean).

**No breaking changes**: every existing public/admin API response shape is unchanged except one
new nullable field (`templateId`) on `Page`; a deployment that never creates a template or
reusable block sees zero behavior change anywhere.

Per the same phase-gate discipline as Phases 1-3: stopped after Phase 4, pending explicit
approval before Phase 5 (Page preview, reusing `preview-token.ts` verbatim) — not started.

## 21. Phase 5 — implementation record (2026-09-12)

**Done.** Page Live Preview, reusing `preview-token.ts` completely unmodified — confirming §1.3's
own prediction that the signing/verification pair generalizes to Page preview with zero code
change to that file itself (its internal payload field is literally named `entryId`, but
neither `signPreviewToken`/`verifyPreviewToken` cares what kind of id it's handed, so a Page's
own id passes through it exactly like an entry's always has).

- `apps/api/src/routes/admin/pages.ts` gained `GET /{id}/preview-token` — a structural
  line-for-line mirror of `routes/admin/entries.ts`'s own (no role gate beyond authentication:
  generating a token proves and writes nothing).
- `apps/api/src/routes/public/preview.ts` gained a second route on the same
  `publicPreviewRoute` app, `GET /pages?route=...&token=...` — a query param (not a path
  param) for the same reason `routes/public/pages.ts`'s own by-route route already uses one: a
  Page's `route` can contain slashes that would otherwise compete with the existing
  `/{contentType}/{slug}` route's own path-segment matching. Reuses `verifyPreviewToken()`
  unmodified with the Page's own id as the expected id, and the exact same "any failure
  (missing route, missing/garbage/expired/mismatched token) collapses to one 404" convention
  entry preview already established — confirmed by a direct comparison test, not just asserted.
  Never edge-cached, same reasoning as entry preview.
- **A new `settings.pagePreviewUrl` column** (migration `0039_nosy_tenebrous.sql`, additive) —
  a second, independent URL template alongside the existing `previewUrl`, since a Page has no
  content-type/slug pair to substitute, only a single literal `route` (e.g.
  `http://localhost:4321{route}`). Deliberately a *separate* column rather than overloading
  `previewUrl` with two incompatible placeholder shapes — an operator's frontend for entries and
  for pages may not even be the same URL structure. Settings → API → Live Preview now shows both
  templates side by side, each labeled with which kind of content it applies to.
- `apps/admin/src/pages/PageEditorPage.tsx` gained a `LivePreviewButton`, a direct structural
  mirror of `EntryEditorPage.tsx`'s own: generates a fresh token from the *saved* page (refusing
  and nudging to save first when the form is dirty — Live Preview shows what will actually
  render right now, which is only true of what's already persisted), substitutes `{route}` into
  `settings.pagePreviewUrl`, and opens the result in a new tab with `?preview_token=...`
  appended. `PageEditorPage`'s `PageForm` gained the same `initial*`-versus-current dirty-check
  pattern `EntryEditorPage`'s `EntryForm` already uses.

**Architectural decisions made during implementation:**
- **No `@kenresoft-cms/astro` client method for Page preview** (unlike `entries.preview()`,
  which already exists) — deliberately deferred to Phase 7 alongside `<PageRenderer>` and the
  rest of the SDK's Page-rendering surface, since nothing in this codebase renders a Page as an
  actual page yet; adding an SDK method with no real consumer would be speculative ahead of the
  concrete need.
- **A genuinely honest limitation, documented rather than hidden**: opening a Page's Live
  Preview link today only does something useful once an operator's own frontend actually
  implements Page rendering (Phase 7) and checks for `preview_token` the way an entry-preview
  page already does — this phase ships the complete backend/admin-UI half of the feature, not a
  working end-to-end preview against `examples/astro-site` (which doesn't render Pages at all
  yet). The Settings UI field's own helper text says this plainly rather than implying it works
  today.

**Verification performed**: `pnpm typecheck`/`pnpm lint` clean workspace-wide. New tests passing
for real: `apps/api/test/page-live-preview.test.ts` (5 tests, real D1 — a direct structural
mirror of `live-preview.test.ts`'s own five cases: unchanged normal-route 404 parity, a full
token-generate-then-preview round trip for both a draft and an already-published page,
no-token/garbage-token/wrong-page-token rejection, and a 404 for a preview-token request against
a nonexistent page) and `apps/admin/test/PageEditorPage.test.tsx` (3 tests — the button's
fetch-token-then-`window.open()` flow, the save-first nudge when the form is dirty, and a plain
save-through-the-API test covering the editor generally, which had no dedicated test file before
this phase). One pre-existing test's fixture (`SettingsPage.test.tsx`'s asserted PUT body) needed
a one-line update for the new `pagePreviewUrl` field now present. Regression sweep: the full
`apps/admin` suite (37 files, 201 tests) in one clean run, and `live-preview`, `pages-routes`,
`public-pages`, `settings-routes`, `health`, `api-docs-gate` all green together in one batch
(no isolated-flakiness workaround needed this time).

**No breaking changes**: every existing public/admin API response shape is unchanged except one
new nullable field (`pagePreviewUrl`) on `Settings`; a deployment that never sets it sees zero
behavior change, and the new public preview route is unreachable without a valid, freshly-issued
token regardless.

Per the same phase-gate discipline as Phases 1-4: stopped after Phase 5, pending explicit
approval before Phase 6 (Navigation `pageId` reference option) — not started.

## 22. Phase 6 — implementation record (2026-09-12)

**Scope shipped**: the Navigation `pageId` reference option described in §3.7 — a contracts/
UI/SDK change only, no database migration (`structured_settings.data` is already a JSON blob).

**Contract change**: `packages/contracts/schemas/structured-settings.ts`'s `navigationItemSchema`
changed from a flat object with a required `url` field to `z.union([...])` of two shapes sharing
a common base (`label`/`visible`/`order`/`external`/`newTab`): one extended with `url: string`,
the other with `pageId: string`. An existing `url`-only row keeps validating and round-tripping
unmodified — no backfill needed, matching the additive/non-breaking bar every prior phase held
to. `NavigationItem`'s inferred type is now that same union, so every consumer must narrow (`'
pageId' in item`) before reading either field — TypeScript enforces this at every call site,
which is exactly why `apps/admin/src/pages/settings/NavigationSection.tsx` needed real changes,
not just a schema edit.

**Admin UI** (`NavigationSection.tsx`): each navigation item row gained a "Target" `<Select>`
(URL / Page) alongside the existing Label field. Choosing "URL" shows the pre-existing URL
`<Input>`; choosing "Page" shows a `<Select>` populated from `usePages()` (admin Pages list,
already built in Phase 3 — no new query hook needed) offering `"{title} ({route})"` per option.
Switching target type rebuilds the item from its common fields plus a fresh `url: ''` or
`pageId: <first available page, or ''>`, discarding whichever target field doesn't apply — the
union shape makes "has both a url and a pageId" structurally impossible, not just discouraged by
convention. `isPageTarget()` is the one type-guard every render/update path funnels through.

**SDK (`@kenresoft-cms/astro`)**: new `resolveNavigationItems(items, pages)` in
`integrations/astro/src/render/resolve-navigation.ts` — a pure function (mirroring `resolve-
route.ts`'s own precedent) that maps a navigation list plus a `{id, route}[]` page list to a flat
list of `{label, href, visible, order, external, newTab}`, resolving a `pageId` to that page's
`route` and leaving a `url` item's `href` unchanged. A `pageId` with no matching page (the Page
was deleted after the nav item was created — Structured Settings doesn't cascade-delete or
validate this at write time) resolves to `href: null` rather than throwing, so a template decides
how to handle a dangling reference instead of the whole navigation render failing. A new
`client.pages.list()` (`GET /api/v1/public/pages`, already existed since Phase 3 — just had no
SDK wrapper yet) supplies the page list `resolveNavigationItems()` needs; deliberately narrow
(id/route/title only), same reasoning as the existing `routePatterns.list()`.

**Verification performed**: `pnpm typecheck`/`pnpm lint` clean workspace-wide (`packages/
contracts`, `integrations/astro`, `apps/admin`, `apps/api`). New tests passing for real:
`integrations/astro/test/resolve-navigation.test.ts` (4 pure unit tests — plain-url passthrough,
pageId resolution, a dangling-pageId null-href case, and a mixed list resolved in order),
`apps/admin/test/NavigationSection.test.tsx` (3 tests — a new item defaults to a URL target, an
item switched to Page target lets the editor pick from real admin pages and saves the `pageId`
shape, and a legacy `url`-only saved item renders and stays unmodified), and one new case added
to `apps/api/test/structured-settings-routes.test.ts` (a PUT accepting a mixed url/pageId list,
and rejecting an item with neither). Regression sweep: the full `apps/admin` suite (38 files, 204
tests) clean in one run; `structured-settings-routes`, `structured-settings-public`,
`structured-settings-legacy-migration`, `pages-routes`, `public-pages`, `health`, `api-docs-gate`
(27 tests) all green together in one batch.

**No breaking changes**: every existing `url`-only navigation item continues to validate and
render exactly as before; no database migration; `examples/astro-site` doesn't consume
Structured Settings navigation at all, so it's completely unaffected either way.

Per the same phase-gate discipline as Phases 1-5: stopped after Phase 6, pending explicit
approval before Phase 7 (`@kenresoft-cms/astro` `<PageRenderer>`/`<BlockRenderer>` and the
`examples/astro-site` catch-all route) — not started.

## 23. Phase 7 — implementation record (2026-09-14)

**Scope shipped**: real rendering of a Page's block tree through `examples/astro-site`, plus
the SDK-level primitives needed to resolve a request path to either a Page or an existing
content entry.

**A deliberate architectural deviation from this document's own original Phase 7 sketch**, not
a silent substitution: §13's plan (and the phase table above, before this record) described
`@kenresoft-cms/astro` itself shipping `<PageRenderer>`/`<BlockRenderer>` and built-in block
components. Implementing this surfaced a real conflict with an already-established, explicit
design precedent — Phase 1's `field-renderers.ts` documents in its own top comment that
`@kenresoft-cms/astro` has "no Astro/React/JSX dependency at all... a plain fetch-wrapper
client," specifically so it stays usable from any frontend framework, not just Astro. Real
Astro components (`.astro` files, `Astro.self`, dynamic-tag component resolution) cannot live
in a framework-agnostic package without breaking that property. Resolved by keeping the SDK
itself framework-agnostic and moving all actual rendering code into `examples/astro-site`:

- `integrations/astro/src/render/resolve-route.ts` gained `resolveSiteRoute(pathname, pages,
  patterns)` — additive, layers an exact-match Page-route check (`{kind:'page', route}`) on top
  of the existing Phase 2 `resolveRoute()` (entry/notFound), which is otherwise completely
  unchanged (signature, tests, behavior).
- `integrations/astro/src/render/block-renderers.ts` (new) — `registerBlockRenderer()`/
  `resolveBlockRenderer()`, a registry holding **only developer-supplied overrides**, never
  built-in defaults. This is deliberate, not an oversight: §6 requires "an explicit override
  always wins regardless of import order," which a single shared map relying on last-write-wins
  import ordering can't guarantee — keeping overrides in their own map, checked before an app's
  own built-in map, makes override-wins structural rather than order-dependent.
- `examples/astro-site/src/components/blocks/` (new) — `HeroBlock`, `RichTextBlock` (a thin
  wrapper over the pre-existing `cms/RichText.astro`), `ImageBlock`, `CtaBlock`, `SpacerBlock`,
  `ColumnsBlock`, `BlockRenderer.astro` (resolves a block's type — checking
  `resolveBlockRenderer()` first, then a local `BUILT_IN_BLOCKS` map — and recurses into
  `columns` children via `Astro.self`), and `PageRenderer.astro` (walks `page.blocks`).
- `examples/astro-site/src/pages/[...route].astro` (new) — the catch-all route: fetches
  `cms.pages.list()` + `cms.routePatterns.list()`, calls `resolveSiteRoute()`, 404s on
  `notFound`, renders via `<PageRenderer>` on a `page` match (with `?preview_token=` support
  mirroring `blog/[slug].astro`'s existing preview-banner pattern), and deliberately still 404s
  on an `entry` match — this example already has purpose-built per-content-type templates
  (`blog/[slug].astro`, etc.), so generic entry rendering here would double-render or diverge
  from those. Astro's own static/named-route-before-rest-parameter-catch-all precedence means
  adding this file doesn't risk breaking any existing hand-authored page; the one caveat (a Page
  created at a route colliding with an existing static file is silently unreachable) is
  documented inline and in `docs/ASTRO.md`, not silently accepted.
- **A real, previously-undiscovered gap closed**: rendering a `reusableBlockRef` block needs the
  referenced block's current type/config at render time (Phase 4's "live reference" semantics),
  but no public route for reusable blocks existed at all — every prior phase only built
  admin-authenticated CRUD. New `GET /api/v1/public/reusable-blocks/:id`
  (`apps/api/src/routes/public/reusable-blocks.ts`), edge-cached and invalidated on write
  (`invalidatePublicReusableBlockCache()` in `apps/api/src/lib/public-cache.ts`, called from the
  existing PATCH/DELETE handlers), mirroring `routes/public/media.ts`'s pattern exactly.
  `@kenresoft-cms/astro` gained `reusableBlocks.get({id})`; `BlockRenderer.astro` special-cases
  a `reusableBlockRef` block by fetching through it before resolving a component.

**A real, non-hypothetical test bug found and fixed while writing this phase's own test file,
not assumed environmental**: `apps/api/test/public-reusable-blocks.test.ts` initially hung
indefinitely (traced to an unhandled `TypeError: fetch failed`/`ECONNREFUSED` rejection) —
first suspected as the project's own well-documented Windows/workerd resource-contention
flakiness, since several concurrent `wrangler dev`/vitest processes really were competing for
ports at the time. After clearing every stray process and confirming an unrelated test file
(`health.test.ts`) ran instantly in the same clean environment, the hang reproduced anyway,
isolated to this one file specifically — proving it wasn't environmental. Root-caused by
bisecting with `vitest --reporter=verbose`: the file's public GET responses populate the route's
edge cache via `ctx.waitUntil(cache.put(...))` (mirroring `routes/public/media.ts`'s pattern),
and two of the test's `SELF.fetch()` calls never read the response body — exactly the gotcha
`public-media-routes.test.ts`'s own comment already documents ("leaving this response's body
unread left that background write... hanging indefinitely under
`@cloudflare/vitest-pool-workers`"), just not yet hit by this specific new file. Fixed by
consuming both previously-unread bodies (`.text()`); the file then passes cleanly and
consistently (2/2, ~650ms). Worth recording here since it's a second, independent instance of a
gotcha this codebase had already named once but not generalized into a shared test-writing rule.

**Verification performed**: `pnpm --filter @kenresoft-cms/astro typecheck`/`test` clean (41/41,
including all new `resolveSiteRoute`/block-renderers tests); `examples/astro-site`'s `astro
check` (0 errors/warnings/hints across 52 files) and `astro build` (server output via
`@astrojs/cloudflare`) both clean; `pnpm typecheck`/`pnpm lint` clean workspace-wide.
`apps/api/test/public-reusable-blocks.test.ts` (2 tests — the public route's shape/404, and
cache invalidation on update) passing against real D1, per the fix above. The full `apps/admin`
suite (38 files, 204 tests) passed clean in one run; a first concurrent run alongside the
still-diagnosing `apps/api` test produced 10 transient 5000ms timeouts, confirmed as this
project's own already-documented resource-contention flakiness (not a regression) by re-running
the suite alone with zero other processes running and getting a clean pass. A live `wrangler
dev` end-to-end round trip (create a Page with blocks via the admin API, fetch the rendered
route through a real deployed instance) was attempted earlier in this phase but repeatedly hit
genuine environmental Windows/workerd resource contention (multiple concurrent `wrangler dev`/
vitest processes, then a bare D1 `select 1` failing against a clean single instance); a
`wrangler deploy --dry-run` confirmed the actual Worker bundle itself is sound. That live pass
was not re-attempted after the unrelated test-infra fix above — the failing signal there was
already correctly diagnosed as environmental before the real bug was found, and re-litigating it
wasn't warranted once the actual code path (typecheck/lint/real-D1 tests/`astro check`/`astro
build`) was fully green.

**No breaking changes**: `resolveRoute()`'s existing signature/behavior/tests are untouched; the
new public reusable-blocks route and SDK additions are all purely additive; a deployment that
never creates a Page or reusable block sees zero behavior change anywhere.

Per the user's explicit "continue with phase 7 after phase 6" instruction (authorizing a
continuation straight from Phase 6 into Phase 7 without a separate approval gate between them,
but not phrased as blanket authorization beyond Phase 7): stopped after Phase 7, pending
explicit approval before Phase 8 (the drag-and-drop visual block editor) — not started.

## 24. Phase 8 — implementation record (2026-09-14)

**Scope shipped**: exactly the phase table's own row 8 scope — drag-and-drop reordering
(dnd-kit, already a dependency), duplicate, and undo/redo — replacing Phase 3's button-based
add/remove/reorder editing UI in `BlockTreeEditor.tsx`. Per §14 decision #3's own explicit
requirement, the underlying `(blocks, onChange)` controlled-component contract and the Page/
Block data model are completely unchanged; this phase touches editing UI only.

**Drag-and-drop**: one `DndContext` wraps the whole block tree, with two independent
`SortableContext`s sharing it — top-level blocks, and (inside a container block like `columns`)
that block's own children — mirroring the exact pattern `ContentTypeDetailPage.tsx`'s field
list already established (`PointerSensor` only, `activationConstraint: {distance: 4}`, no
keyboard sensor). `handleDragEnd` resolves which of the two lists a dragged id belongs to
before reordering; blocks never move between the two lists, since there's no cross-container
concept to support under the existing two-tier nesting cap (§19) — a plain lookup is correct
here, not full multi-container dnd-kit machinery. The chevron up/down buttons and their
`onMoveUp`/`onMoveDown` props are gone, replaced by a `GripVertical` drag handle — the same UX
change `ContentTypeDetailPage.tsx` already made for fields, kept consistent rather than leaving
two different reorder idioms in the admin.

**Duplicate**: a `Copy` button per block (and per child) inserts a deep clone — a fresh `id`
for the block itself and, if it has children, a fresh `id` for each child too — directly after
the original. Cloning never needs to walk deeper than one level, matching the two-tier nesting
cap this system has held since Phase 3.

**Undo/redo**: `BlockTreeEditor` now owns a `history`/`future` stack of `blocks` snapshots
internally. Every mutation (add/remove/duplicate/reorder/config edit, including inside a
container's children) funnels through one `emitChange()` that pushes the current state onto
`history`, clears `future`, and calls the parent's `onChange` — so `PageEditorPage`/
`TemplatesPage` (both already just pass `blocks`/`setBlocks` straight through) see no contract
change at all. `undo()`/`redo()` pop/push between the two stacks. Deliberately scoped to the
current editing session only (the stack resets on remount, which already happens per-page via
`PageEditorPage`'s `key={page.id}`) rather than persisted — undo/redo is an editing convenience,
not something that needs to survive navigating away and back. No keyboard shortcuts (Ctrl+Z/
Ctrl+Shift+Z) — toolbar buttons only, avoiding the real risk of a global shortcut listener
capturing keystrokes meant for the title field or the rich-text editor nested inside the same
form.

**Deliberately not built**: a "layers" panel (a flat tree view of every block for quick
navigation) and a distinct "responsive preview" mode, both mentioned in this document's original
Phase 8 sketch prose (§14 decision #3) but not listed in the phase table's own row 8 scope —
the table is what every prior phase actually followed, and building UI beyond it here would be
speculative ahead of a concrete need. Live Preview (Phase 5) already covers seeing a page at
real size in a real browser tab, which is most of what a "responsive preview" would offer
anyway.

**A real test-infrastructure adjustment, not a bug**: the existing "reorders two blocks with
the move-down/move-up buttons" test in `BlockTreeEditor.test.tsx` no longer has buttons to
click, so it was replaced with duplicate and undo/redo tests instead (both button-clickable and
directly testable). The drag gesture itself isn't unit-tested — matching this codebase's own
existing precedent: `ContentTypeDetailPage.tsx`'s dnd-kit field-reorder list has never had a
drag-simulation test either, since jsdom can't drive dnd-kit's real pointer-sensor sequence.

**Verification performed**: `pnpm --filter @kenresoft-cms/admin typecheck` (via `tsc --noEmit -p
tsconfig.json`) clean; `pnpm eslint` on the changed files clean. `BlockTreeEditor.test.tsx`
(now 7 tests — add/remove/duplicate/undo-redo/nested-child/leaf-block-has-no-children/media-
picker/reusable-block-picker) plus a regression run of `PageEditorPage.test.tsx`,
`PagesPage.test.tsx`, `ReusableBlocksPage.test.tsx`, and `TemplatesPage.test.tsx` (5 files, 20
tests total) all passing — the latter three confirm every existing consumer of
`BlockTreeEditor`/`BlockConfigForm` (Pages, Reusable Blocks, Templates) keeps working unmodified
through the same `(blocks, onChange)`/`(fields, config, onChange)` contracts.

**No breaking changes**: no API, contract, or database change of any kind — this phase is
entirely `apps/admin` editing-UI code. Every page that composes a block tree (Page Editor,
Templates) gains drag-and-drop/duplicate/undo-redo automatically, with no per-page changes
needed, since all three already delegated to `BlockTreeEditor` as a single shared component.

Per the same phase-gate discipline as Phases 1-7: stopped after Phase 8, pending explicit
approval before Phase 9 (plugin-contributed block types) — not started.

## 25. Phase 10 (hardening pass only) — implementation record (2026-09-14)

**Scope**: with the user's explicit sign-off, Phase 9 (plugin-contributed block types) stays
genuinely not-started — no plugin currently needs a block type, and §9 itself says not to build
this speculatively. Phase 10's "patterns/presets" half was also deliberately skipped (it has no
design anywhere in this document, unlike every other phase, which each got a `§3.x` design
subsection before implementation began — building it now would have been speculative in the
same way). What's actually done here is Phase 10's other half: a production hardening pass —
re-verifying perf/security/cache behavior across everything Phases 1-8 shipped, fixing anything
real it found.

**A real, serious, previously-undiscovered data-loss bug, found across four routes, not
hypothetical**: `updateReusableBlockSchema`, `updateTemplateSchema`,
`updateFieldDefinitionSchema`, and `updateFormFieldSchema` were all derived via
`createXSchema.partial()` (or `.omit({...}).partial()`), and each of their corresponding create
schemas has at least one field with `.optional().default(...)`. `.partial()` only widens a
field's *type* to optional — it does not strip an already-present `.default(...)` — so a PATCH
that genuinely omits that one field still parses to the default value, not `undefined`,
silently overwriting real data on every partial update that didn't happen to resend it:
- `reusable_blocks.config` reset to `{}` on any update omitting `config` (e.g. a rename).
- `templates.blocks` reset to `[]` and `isDefault` reset to `false` on any update omitting
  either — confirmed as an *actual* write, not just a type-level footgun: `routes/admin/
  templates.ts`'s own `input.blocks ? {...} : undefined` guard, written under the (violated)
  assumption that an omitted field parses to `undefined`, doesn't catch it either, since `[]` is
  truthy in JavaScript.
- `field_definitions.required` and `form_fields.required` both reset to `false` on any update
  omitting `required` — the more concerning pair, since a silently-un-required field is a
  content-integrity/validation gap, not just a display regression.

None of this had shipped a visible bug, confirmed by checking every actual caller: the admin UI
(`ReusableBlocksPage.tsx`, `TemplatesPage.tsx`, `ContentTypeDetailPage.tsx`'s field dialog, the
form-field builder) always resends every field on every save, masking the defect completely in
practice. It's real regardless — a bare `PATCH` from any other caller (a script, an external
integration, a future UI change that only sends what actually changed, which is the more natural
way to implement a PATCH endpoint) would silently corrupt data with no error of any kind. Found
by direct code audit (reading every schema `.partial()` is called on and checking its base
schema for `.default()`), not by a failing test — confirmed with a standalone Zod repro
(`updateTemplateSchema.safeParse({name: 'x'})` → `{name: 'x', blocks: [], isDefault: false}`,
not `{name: 'x'}`) before touching any route code.

**Fixed** by replacing all four `.partial()`-derived schemas with hand-written ones (matching
`updatePageSchema`'s already-correct pattern — no field has a `.default()`, so an omitted field
parses to real `undefined`). A full audit of every other `.partial()` use in the workspace
(`content-types.ts`, `forms.ts`, `packages/plugin-ecommerce`) confirmed none of their base
schemas have any defaulted field, so they were already safe and needed no change — the fix was
scoped to exactly the four affected files, not applied blanket.

**A second, smaller, real gap fixed in the same pass**: `reusable_blocks.config` was validated
only as an untyped `z.record()` — unlike Pages/Templates, which run every block's config through
`BLOCK_CONFIG_SCHEMAS[type]` via `validateBlockTree()` (per-type `.strict()` shape, length/type
limits). A reusable block's config is rendered through the exact same per-type block component
as a Page's own inline block, so it should be held to the same shape guarantee. Fixed by adding
`validateReusableBlockConfig()` to the admin create/update routes, validating the *merged*
type+config (not just whichever fields one PATCH happens to include) so a `type` change without
an accompanying `config` is correctly rejected rather than silently storing a mismatched pair.

**Everything else audited and confirmed already correct, no change needed**: the
`PUBLIC_CONTENT_RATE_LIMITER` (applied broadly to `/api/v1/public/*` before the route-specific
mounts) already covers every Phase 1-8 public route, including the new Phase 7 reusable-blocks
route. Page route-rename cache invalidation correctly purges both the old and new route.
`invalidateAllPageCaches()`'s full-namespace purge on a reusable-block edit is bounded by the
existing `cache_purge_jobs` batch-processing queue, not a synchronous unbounded sweep — already
scale-safe by construction. `BlockRenderer.astro`'s handling of a dangling `reusableBlockRef` (a
deleted reusable block) and `resolveBlockRenderer()`'s registry (a plain `Map` lookup, never
`eval`'d or dynamically imported) were both re-confirmed safe by direct inspection. The SDK's
`reusableBlocks.get()` correctly returns `null` on a 404, matching every other consumer's
null-safe handling.

**Verification performed**: `pnpm typecheck`/`pnpm lint` clean workspace-wide. New/strengthened
regression tests added directly targeting the fixed bug — a name-only PATCH now asserts `config`/
`blocks`/`required` survive unchanged in `reusable-blocks-routes.test.ts`,
`templates-routes.test.ts`, `admin-routes.test.ts`, and `forms-routes.test.ts` — plus a new test
covering the config-schema-validation fix (create and update, including the merged-type-change
case). Every file consuming any of the four fixed schemas (confirmed exhaustive by grepping the
whole codebase for each import) passing individually: `reusable-blocks-routes`,
`templates-routes`, `admin-routes`, `forms-routes`, `audit-log`, `field-presentation`,
`field-reorder`, `content-type-route-pattern`, `pages-routes`, `public-reusable-blocks` (10
files, all green). This pass hit a worse variant of this codebase's own standing Windows/
workerd-flakiness note than previously documented — even 6-file batches reliably failed after
several hours of continuous testing, traced partly to ~440 stale `miniflare-*` temp directories
never cleaned up across the session (cleared, but batches above ~2 files still failed
afterward). Verified via single-file/2-file runs instead, which stayed reliable throughout; a
full single-pass run of the entire `apps/api` suite (66 files) was not obtained this session —
flagged honestly rather than claimed, open for a fresher environment to confirm. The full
`apps/admin` suite (38 files, 205 tests, a different non-workerd runtime unaffected by this) ran
clean in one pass.

**No breaking changes to any valid caller**: every existing caller that already resends full
payloads (the entire shipped admin UI) behaves identically before and after — the fix only
changes behavior for a payload that omits a field with the now-removed default, which is exactly
the corruption case being closed, not a supported use anyone depended on.

Per the same phase-gate discipline as every prior phase: stopped after this hardening pass,
pending explicit direction on Phase 9 (plugin-contributed block types, still deliberately
deferred) and the "patterns/presets" half of Phase 10 (still deliberately undesigned).
