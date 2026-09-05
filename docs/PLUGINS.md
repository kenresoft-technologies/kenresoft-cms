# Plugin Platform

**Status: Phase 1 (generic plugin platform + `plugin-hello` proof) complete, 2026-09-04.
Plugin enablement moved from a static file to a DB-backed, live-toggleable model (also
2026-09-04) — see Enablement below, which supersedes Phase 1's original design. Phase 2a
(Commerce catalog domain — products, variants, categories, images) complete, 2026-09-05 — see
the end of this document. It needed two generic platform extensions, both documented below:
unauthenticated public plugin routes, and grouped admin-nav entries. Cart, checkout/orders, and
payments/Paystack (2b–2d) remain not started.

## What this is

Kenresoft CMS is evolving from a single-purpose CMS into a plugin-extensible platform. A plugin
is a normal TypeScript package (`packages/plugin-<id>`) that contributes its own database
tables, API routes, and admin UI, without Core (`apps/api`'s route files, `packages/database`'s
core schema) ever containing plugin-specific business logic. Plugins are **composed at
build/deploy time** — there is no runtime dynamic code loading, and no database-driven "which
plugins exist" state; a Cloudflare Worker bundles everything ahead of time, so that's what this
platform is built around.

`packages/plugin-hello` is the Phase 1 proof-of-concept: a trivial plugin demonstrating every
extension point (a migration, an API route, an admin nav entry + page, a permission, a config
value, an event) with zero real domain logic. Read its four files
(`manifest.ts`/`config-schema.ts`/`repository.ts`/`routes.ts`) as the reference for what a real
plugin's shape looks like.

## The manifest and SDK

`@kenresoft-cms/plugin-sdk` (`packages/plugin-sdk`) is the one package both `apps/api` and every
plugin package depend on — neither ever depends on the other's internals. It exports:

- `PluginManifest`/`pluginManifestSchema` — a plugin's identity (`id`, `name`, `version`,
  `sdkVersion`), an optional human-readable `description` (shown on the admin Plugins page), its
  declared `dependencies` (other plugin ids), `capabilities`, and `permissions`.
- `PluginContext` — the one object a plugin's route handlers ever receive to reach Core: `db`,
  `user`, `hasRole()`, `media`, `config`, `events`, `logger`.
- `PluginRegistration` — the code-level object (manifest + the plugin's actual Hono sub-app +
  optional config schema/lifecycle hooks) that `apps/api/src/plugins/registered-plugins.ts`
  imports per plugin.
- `requirePluginRole(minimum)` — route middleware, mirroring `apps/api`'s own `requireRole()`
  idiom exactly.
- `createPluginOpenApiApp()` — mirrors `apps/api/src/lib/openapi.ts`'s validation-error shape, so
  a plugin's 400 responses look identical to Core's.

`PLUGIN_SDK_VERSION` is bumped only when a change here would break an existing plugin. The
registry (`apps/api/src/plugins/registry.ts`) rejects any plugin whose `manifest.sdkVersion`
doesn't match exactly, at Worker module-load — a misconfigured plugin fails clearly at
cold-start/deploy time, never obscurely per-request.

## Enablement

**A plugin's code must still be bundled into the Worker at build time** — Cloudflare Workers
compile everything ahead of deploy, and this platform doesn't fight that (no Dynamic Worker
Loader, no fetching-and-`eval`-ing remote code; see §3.4/§56 of the source spec's own explicit
non-goals). `apps/api/src/plugins/registered-plugins.ts` is still the *only* Core file that
imports a specific plugin package — every other Core file, including `index.ts`, only ever
imports from `./plugins/*`, never a specific plugin.

**Whether a bundled plugin is currently switched on is a different question, and it *is*
DB-backed and live-toggleable** — an admin can flip it from a new admin "Plugins" page with no
redeploy. This is a deliberate revision of Phase 1's original design (a static
`plugins.config.ts` file, edited and redeployed to toggle anything) — that file is gone. What
replaced it:

- `packages/database/schema/plugin-enablement.ts`'s `plugin_enablement` table (Core-owned, one
  row per plugin, `pluginId`/`enabled`/`updatedAt`) — no row for a given plugin id means
  **enabled by default**.
- `apps/api/src/plugins/registry.ts`'s `validatePlugins()`/`VALIDATED_PLUGINS` still run once at
  Worker module-load, but now only do what can actually be decided before any request (and
  therefore any D1 binding) exists: manifest shape, `sdkVersion`, duplicate ids. This is
  everything Phase 1's `resolvePlugins()`/`ENABLED_PLUGINS` used to do *except* deciding
  enablement — that decision moved out because it can change without a redeploy, so it can't be
  resolved this early anymore.
- `apps/api/src/plugins/enablement.ts`'s `requirePluginEnabled(pluginId)` — a **per-request**
  middleware, applied at the top-level app *before* `requireSession` for every validated
  plugin's mount point:
  ```ts
  app.use(`${base}/*`, requirePluginEnabled(plugin.manifest.id));
  app.use(`${base}/*`, requireSession);
  ```
  Checking enablement before session so a disabled plugin 404s unconditionally regardless of
  auth state — matching this codebase's existing "disabled/unconfigured is indistinguishable
  from not installed" convention (the break-glass owner-recovery route). It also checks the
  plugin's declared `manifest.dependencies` are *currently* enabled, not just installed —
  Phase 1's static dependency check, adapted to live state.
- `apps/api/src/routes/admin/plugins.ts` — `GET /api/v1/admin/plugins` (readable by any
  authenticated role — apps/admin's nav/command-palette need every role to know whether a
  plugin's link should render, and this isn't sensitive data, only the ability to change it is)
  and `PATCH /api/v1/admin/plugins/{id}` (admin-only), backing the new
  `apps/admin/src/pages/PluginsPage.tsx`.
- `apps/admin/src/plugins/registry.ts`'s `PluginNavItem` gained a required `pluginId`, and both
  `AppLayout.tsx` and `command-palette.tsx` filter `pluginNavItems` against the live list before
  rendering — a disabled plugin's link disappears instead of just 404ing when clicked.

**Hono's route composition doesn't change** — every validated plugin's routes are still mounted
unconditionally at cold start (cheap, static); only actual request *handling* is now gated by a
live DB check. **Known, accepted cost, not solved speculatively**: this is one extra D1 read per
request to a plugin route. No cross-request caching was added — a stateless Workers request has
no safe in-memory cache across requests without KV/Cache API, which would trade correctness for
speed and isn't warranted yet at this scale.

Disabling a plugin never deletes its own data — a destructive uninstall/data-deletion operation
remains a deliberately separate, not-yet-built concern. Adding a *genuinely new* plugin — one not
yet bundled into this deployment at all — still requires a real code change (the package + one
line in `registered-plugins.ts`) and a redeploy; only toggling something already bundled is live.

## Public (unauthenticated) plugin routes

Every plugin mount was session-gated through Phase 1 — fine for Hello, but a storefront-facing
catalog needs a real, unauthenticated read API, the first need of this shape. Commerce's catalog
(Phase 2a) is the plugin that needed it, so the extension was built generically rather than as a
one-off, mirroring Core's own `/api/v1/public/*` vs `/api/v1/admin/*` split:

- `PluginRegistration.publicRoutes?` — an optional second Hono sub-app, alongside the existing
  (always session-gated) `routes`.
- `PluginPublicContext` (`packages/plugin-sdk/src/context.ts`) — deliberately smaller than
  `PluginContext`: `pluginId`, `db`, `media`, a **read-only** `config` (`Pick<PluginConfigService,
  'get'>`), `logger`. No `user`, `hasRole()`, or `events` — there is no session to scope them to,
  and a public route has no business emitting an authenticated-actor event.
- `apps/api/src/plugins/mount.ts` mounts `plugin.publicRoutes` (when present) at
  `/api/plugins/<id>/public/v1/*`, gated by the **same live `requirePluginEnabled` check** the
  admin mount uses — a disabled plugin's storefront API 404s too, not just its admin API — plus
  Core's existing `publicContentRateLimit` middleware (reused as-is, no new rate-limiter
  binding), but **never** `requireSession`.

A public route still enforces its own read-only security convention by hand, the same way Core's
own public content API does: `plugin-ecommerce`'s public routes filter to
`active`/`published` at the query layer and 404 a draft product by slug exactly like a
nonexistent one (see `packages/plugin-ecommerce/src/routes/public.ts`) — this isn't automatic,
a plugin author has to apply it, matching how Core's own `entries.ts` does it.

## Grouped admin-nav entries

`PluginNavItem` (`apps/admin/src/plugins/registry.ts`) gained an optional `group?: string`,
defaulting to `"Plugins"` when omitted. `AppLayout.tsx` renders one `SidebarGroup` per distinct
group value instead of always one shared group. Hello (one page) needed nothing here; Commerce
(three pages — Products/Categories/Settings) registers all three under its own `"Commerce"`
group instead of piling into the shared one. `pluginId` still gates visibility per entry (not
per group), so all of a disabled plugin's entries disappear together regardless of how many
groups they're split across.

## Migrations: how a plugin owns a table here

This deployment has exactly one D1 database, one `migrations_dir`
(`packages/database/migrations`), and one `drizzle-kit generate` run reading one
`packages/database/schema/index.ts`. There is no per-plugin migration history and no runtime
migration loader — and Phase 1 does not introduce either.

A plugin's table is defined in `packages/database/schema/plugins/<id>.ts` (e.g.
`schema/plugins/hello.ts`'s `plugin_hello_greetings`), fanned into the same `schema/index.ts` as
every Core table, and picked up by the existing `drizzle-kit generate` → sequential
`NNNN_*.sql` pipeline with **zero changes to that tooling**. "A plugin owns its table" is
enforced by:

- the `plugin_<id>_` table-name prefix;
- convention — only that plugin's own repository file (`packages/plugin-<id>/src/repository.ts`)
  ever queries it, never a Core repository or another plugin's;

not by a physically separate migration history or D1 database. Building either would be real,
unwarranted engineering for what this platform actually needs today. When you add a new plugin
schema file: run `pnpm --filter @kenresoft-cms/database generate` and commit the resulting
migration *before* deploying with that plugin enabled — there is no runtime check that a
plugin's table actually exists.

## The SDK's database boundary — honestly stated

`PluginContext.db` is the exact same singular `Database` type Core's own repositories use. This
is accepted for Phase 1 because it reuses the existing D1/Drizzle architecture with zero new
plumbing, but it is an explicitly **temporary, convention-enforced boundary, not a mechanical
one**: a plugin's own repository file may only touch its own `plugin_<id>_*` tables, never Core
tables — enforced by code review and this document, not the type system. `PluginContext` is
named as its own interface (not a bare re-export of `Database`) specifically so a future version
can narrow it into a per-plugin scoped query interface without changing `PluginRegistration`'s
shape at all.

## Permissions

`manifest.permissions` is a real, namespaced string array (`<plugin-id>:<resource>:<action>`,
e.g. `hello:greeting:create`) — but in Phase 1 it is **documentation/discovery metadata only**,
never itself checked against a request. Actual enforcement reuses Core's existing 5-level role
hierarchy (`owner > admin > editor > author > viewer`, `packages/contracts/schemas/enums.ts`) via
`requirePluginRole(minimum)`, mirroring `apps/api`'s own `requireRole()` idiom exactly. Building a
parallel, granular permission-enforcement engine for what this platform needs today would be
exactly the kind of speculative refactor this codebase's own conventions warn against — but the
namespaced string shape means a future granular enforcement layer can consume this same manifest
field without a breaking change.

## Capabilities

`manifest.capabilities` (`'database' | 'media' | 'auth' | 'rbac' | 'events' | 'email' |
'storage'`) is validated by the registry for well-formedness only (catches typos against a known
union). It does **not** gate what `PluginContext` exposes at runtime — every enabled plugin gets
the full context surface regardless of what it declares. Per-capability context-stripping is
future work, relevant if third-party or less-trusted plugins are ever introduced.

## Plugin configuration

`packages/database/schema/plugin-settings.ts`'s `plugin_settings` table is Core-owned, generic
infrastructure any plugin can use for its own non-secret configuration — one row per plugin
(`pluginId` primary key, `config` JSON, `configVersion` integer, `updatedAt`), not a
plugin-specific table, since config storage is a mechanism every plugin needs identically.
`config`'s meaning is entirely up to the plugin: `PluginContext.config.get()`/`.set()`
(`apps/api/src/plugins/context.ts`) validate it against the plugin's own `configSchema` (a Zod
schema declared on its `PluginRegistration`) before handing it back — Core's repository/table
stays 100% generic JSON in/out.

**Never store secrets in `plugin_settings`.** Payment-provider keys, API tokens, anything
deployment-sensitive belongs behind `wrangler secret put`, exactly like `BETTER_AUTH_SECRET`/
`OWNER_RECOVERY_SECRET` (see `docs/DEPLOYMENT.md`) — never an ordinary database column, plugin or
otherwise.

`configVersion` (default `1`) exists so a future plugin can ship a config-shape migration (e.g.
renaming a key) with a real "what shape is this row" marker to branch on, instead of a fragile
guess-the-old-shape read path — nothing reads or writes it beyond that default yet.

## Events — best-effort, not a durable queue

`PluginContext.events` (`apps/api/src/plugins/events.ts`'s `pluginEventBus`) is an **in-process,
best-effort, synchronous** emit/on bus — a module-scope singleton, no persistence, no retry, no
cross-request delivery guarantee. A handler runs synchronously within the same request that
called `emit()`; a handler that throws is caught and logged, never allowed to break the request
that emitted the event.

**No critical business state transition may depend solely on an event handler firing.** A Worker
isolate recycling mid-dispatch, or a handler that throws, loses that delivery silently. The
existing `apps/api/src/lib/webhooks.ts` mechanism — DB-backed (`webhook_deliveries`), retried on
the existing 5-minute Cron Trigger — remains the durable-delivery answer whenever one is actually
needed. Future durable/background plugin event processing, if ever required, should use
Cloudflare Queues or extend that existing retry pattern, not this bus.

## Lifecycle hooks

`PluginRegistration.hooks?.onEnable` is declared for type-safety/future-proofing only. Phase 1
does not trigger it at runtime — there is no clean per-Worker-request moment to safely run an
"install" step on Cloudflare Workers. Declared-but-inert, not silently dropped.

## Admin UI: split, not colocated

A plugin's server-side code (manifest, migration, API route, config schema) lives in
`packages/plugin-<id>`. Its admin nav entry and page live in `apps/admin/src/plugins/<id>/`
instead — registered in `apps/admin/src/plugins/registry.ts`'s `pluginNavItems`/`pluginRoutes`
arrays, the one place both `AppLayout.tsx`'s sidebar and `command-palette.tsx` read plugin
entries from. This mirrors the flat-typed-array pattern `apps/admin/src/pages/settings/
sections.tsx` already uses for Settings' own extension points.

This split is deliberate, not an oversight: `apps/admin` is documented (`apps/admin/README.md`)
as cloneable standalone, with no sibling workspace packages — it depends on
`@kenresoft-cms/contracts` via a published npm version, not `workspace:*`, specifically so it
survives being copied out alone. Giving `apps/admin` a real `workspace:*` dependency on a plugin
package would regress that property for every deployment, not just ones that enable that
plugin's admin UI. The cost: a plugin's admin contribution is split across two locations instead
of one, wired together by hand in both registries.

This is the Phase 1 composition model, not a permanent constraint. A published
plugin-UI-distribution mechanism (e.g. a plugin shipping its own admin bundle, loaded some other
way) is a real future option if third-party plugin distribution ever becomes a requirement —
out of scope for now.

## Known limitations

- *Which plugins exist* is still configured independently in `apps/api`
  (`registered-plugins.ts`) and `apps/admin` (`src/plugins/registry.ts`'s `pluginNavItems`) — no
  shared, build-time-readable source between the two separately-deployed Workers. (*Whether* an
  already-registered plugin is currently enabled is no longer independent — both apps read the
  same live `GET /api/v1/admin/plugins` truth, per the Enablement section above.) Trivial to
  keep in sync by hand for one or two plugins; worth solving generically only if plugin count
  grows.
- One extra D1 read per request to any plugin route, to check live enablement — an accepted
  cost, not cached across requests (see Enablement above).
- No per-capability context restriction, no lifecycle hook execution, no runtime migration
  existence check — all noted above, all deliberate Phase 1 scope reductions.
- No granular permission enforcement engine — Core's existing role hierarchy is the enforcement
  mechanism; `manifest.permissions` is discovery metadata.

## Commerce (Phase 2a: catalog domain) — done, 2026-09-05

`packages/plugin-ecommerce` is the first real vertical plugin built on this platform — Phase 2a
covers only the product catalog: categories (self-referencing hierarchy), products, variants
(flat `attributes` JSON blob, deliberately no normalized option/value model), and product images
(associating Core's own `media` rows, never managing R2 objects independently). Full admin CRUD
(`requirePluginRole('editor')` on writes) plus the public, unauthenticated storefront read API
described above. Money is modeled as integer minor units + a currency code column — the first
monetary convention in this codebase, established here since nothing else had modeled money
before; never floating point.

Cart & customer (2b), checkout & orders (2c), payments/Paystack (2d), and storefront integration
into `@kenresoft-cms/astro`/`examples/astro-site` (2e) remain **not started** — each is a
separate future pass, payments especially, given real money and webhook-signature verification
are involved.
