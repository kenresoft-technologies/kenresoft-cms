# Plugin Platform

**Status: Phase 1 (generic plugin platform + `plugin-hello` proof) complete, 2026-09-04.
Plugin enablement moved from a static file to a DB-backed, live-toggleable model (also
2026-09-04) — see Enablement below, which supersedes Phase 1's original design. Phase 2a
(Commerce catalog domain — products, variants, categories, images) complete, 2026-09-05. Phase 2b
(Commerce cart & customer accounts) complete, 2026-09-07. Phase 2c (Commerce checkout & orders,
with real concurrency-safe stock enforcement) complete, 2026-09-08. Phase 2d (Commerce payments/
Paystack, plus checkout idempotency closing a Phase 2c gap) complete, 2026-09-08 — see the end of
this document. Together these four Commerce passes needed six generic platform extensions, all
documented below: unauthenticated public plugin routes, grouped admin-nav entries, a plugin email
capability, a generic per-plugin public rate-limit declaration, (2b's hardening follow-up) a
`PluginBindings.CORS_ORIGINS` field backing a per-plugin explicit Origin/CSRF check, and (2d) a
`PluginContext.payments`/`PluginPaymentsService` capability wrapping a pluggable payment-provider
layer. Phase 2e (storefront integration into `@kenresoft-cms/astro`/`examples/astro-site`) complete,
2026-09-08 — see the end of this document.

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
  `user`, `hasRole()`, `media`, `config`, `events`, `email`, `logger`.
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

## Plugin email

A plugin previously had no way to send mail at all. Commerce's cart & customer domain (Phase 2b)
needed one for password-reset/verification email, so this wraps Core's existing pluggable email
layer generically rather than as a one-off:

- `PluginEmailService` (`packages/plugin-sdk/src/context.ts`) — one method, `send({ to, subject,
  text, html? })`, matching `apps/api/src/lib/email/types.ts`'s `EmailMessage`/`EmailSender`
  shape exactly. Exposed as `PluginContext.email` **and** `PluginPublicContext.email` — a
  password-reset-request route is itself unauthenticated.
- `apps/api/src/plugins/context.ts` constructs it via `getEmailSender(c.env as unknown as
  Bindings)`, reusing `apps/api/src/lib/email/*`'s existing provider selection
  (`EMAIL_PROVIDER` — cloudflare/resend/noop) as-is. The cast is deliberate: `PluginBindings`
  (the plugin-facing type contract) stays `{ DB, MEDIA_BUCKET }` only — email-provider bindings
  never become part of a plugin's visible type surface, exactly like `PluginContext.media`
  already hides R2/D1 specifics behind a curated interface. No new env vars, no plugin ever picks
  a provider or sees its credentials.
- A plugin sending mail should fire-and-forget via `c.executionCtx.waitUntil(ctx.email.send(...))`
  — mirrors `apps/api/src/routes/public/password-reset.ts`'s existing pattern exactly.

## Generic per-plugin public rate-limit declaration

The generic `publicContentRateLimit` every public mount already gets (300/60s per IP) is
deliberately loose — fine for reads, not tight enough for a login/registration surface. Rather
than hardcode a Commerce-specific limiter into Core's `mount.ts` (which would violate "Core never
contains plugin business logic"), a plugin can declare its own tighter rule on one sub-path of
its own public mount:

- `PluginRegistration.publicRateLimits?: { pathPrefix: string; bindingName: string }[]`
  (`packages/plugin-sdk/src/registration.ts`) — `pathPrefix` is relative to the plugin's own
  public mount (e.g. `/customer-auth`), `bindingName` is the exact `wrangler.toml [[ratelimits]]`
  binding name to enforce against that sub-path.
- `apps/api/src/plugins/mount.ts` applies a new `createPluginRateLimitMiddleware(bindingName)`
  (`apps/api/src/plugins/plugin-rate-limit.ts`) at `${publicBase}${pathPrefix}/*` for each
  declared rule — registered on the outer app, in addition to (not instead of) the generic
  limiter, same ordering precedent as `requirePluginEnabled`/`publicContentRateLimit`. Nothing
  about this mechanism names any specific plugin.
- If the named binding is genuinely missing from a deployment's `wrangler.toml`, the middleware
  **fails open** with a loud `console.warn` (visible in `wrangler tail`) rather than hard-failing
  every request on that sub-path — a forgotten deployment step shouldn't take down login
  entirely, but the gap must stay loud, not silent.
- Commerce declares one rule: `{ pathPrefix: '/customer-auth', bindingName:
  'COMMERCE_CUSTOMER_AUTH_RATE_LIMITER' }` (10/60s per IP, mirroring `AUTH_RATE_LIMITER`'s own
  posture), covering register/login/logout/password-reset/verify-email as one sub-path. Cart/
  customer-profile routes rely on the generic limiter only.

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

## Commerce (Phase 2b: cart & customer accounts) — done, 2026-09-07

Real, hand-rolled customer accounts — deliberately separate from better-auth (reserved for CMS
staff): register/login/logout, password reset, email verification, profile, addresses, and a
guest-or-authenticated shopping cart with merge-on-login. Depends only on `@better-auth/utils`'s
standalone hashing primitives (`hashPassword`/`verifyPassword` from `@better-auth/utils/password`,
`createRandomStringGenerator` from `@better-auth/utils/random`) — never on better-auth's own
identity/session/database-adapter system or a `betterAuth({...})` instance. Chosen over depending
on the full `better-auth` package specifically because doing so once shifted pnpm's shared
peer-resolution for zod across every *other* better-auth consumer in the workspace (including
apps/admin's own, unrelated CMS-staff auth client) onto a different version and broke its
typecheck — `@better-auth/utils` has no dependency beyond `@noble/hashes`, so it can't do that.

Six new `plugin_commerce_`-prefixed tables: `customers`, `customer_sessions` (hashed session
tokens, 30-day fixed TTL), `customer_tokens` (password-reset/email-verification, hashed,
single-use via delete-on-consume — the same mechanism recovery-codes/CMS password-reset already
use), `customer_addresses`, `carts` (`customerId` nullable = a guest cart, identified purely by
possessing its own unguessable id via a cookie — never accepted as identity for any
customer-scoped route), `cart_items` (cascades on product/variant delete, unlike a future Order,
which must snapshot catalog data independent of the live row).

Security posture, reviewed and revised before implementation (not assumed correct on the first
pass): password-reset always returns an identical generic response regardless of whether the
email matches an account; login returns one generic "invalid credentials" message for both a
wrong password and a nonexistent email; registration *does* distinguish "already registered" — a
deliberate usability-over-enumeration-resistance tradeoff at that one endpoint only. CSRF defense
for the customer/cart cookies (`sameSite: 'none'`, since a storefront isn't guaranteed same-site
with the API) comes from three layers, not `SameSite` itself: the *existing* global
`corsMiddleware` (`apps/api/src/middleware/cors.ts`, already `credentials: true` with an explicit
allow-list, never a wildcard); every mutation requiring `application/json`, which forces a
non-simple, preflighted CORS request a browser won't send to an untrusted origin's page; and (a
hardening-pass addition, 2026-09-08) an explicit, server-side per-request Origin check
(`requireTrustedOriginForMutations`, `packages/plugin-ecommerce/src/lib/origin-check.ts`, reading
a new `PluginBindings.CORS_ORIGINS` field the SDK now exposes) applied to every mutating route on
cart/customer/customer-auth — added specifically because a body-less mutation like
`POST /customer-auth/logout` is a "simple" cross-origin request under the Fetch spec, sent by a
browser with no preflight and therefore no CORS check ever consulted server-side; only the JSON
*response* would be blocked from an attacker page's own JS, not the logout side effect that
already fired. The check rejects a mutating request whose `Origin` header is present but not in
the allow-list; a genuinely missing `Origin` (non-browser clients, and this project's own
`SELF.fetch` test harness, which sends none) is passed through, mirroring the same asymmetry this
file's better-auth entries already documented for `/api/v1/auth/*`. A storefront needing
credentialed browser-JS calls to `/customer/*`/`/cart/*` must have its real origin added to the
deployment's existing `CORS_ORIGINS`. Cart-time stock capping against a
variant's `stockQty` is advisory only, never a reservation — real atomic stock enforcement is
Phase 2c's job at order creation. Login/register/logout/password-reset/verify-email share one
`COMMERCE_CUSTOMER_AUTH_RATE_LIMITER` bucket (10/60s per IP) via the generic per-plugin
rate-limit mechanism above; this bucket's state persists across every test in one vitest file
(confirmed empirically, not assumed), which shaped how the test suite is split.

Guest-cart-to-customer-cart merge on login/register sums matching `(productId, variantId)` line
quantities (capped at current tracked stock) and moves any guest-only lines over, all as one
`db.batch()` call — the same atomic-multi-write idiom `routes/admin/security.ts`'s
ownership-transfer fix established, so a partial merge can never leave inconsistent state.
`GET /cart` is side-effect-free by design: a cart is only ever created inside `POST /cart/items`,
the first add-to-cart call.

A short hardening pass (2026-09-08) closed four smaller gaps found on review, alongside the CSRF
check documented above. `consumeCustomerToken` (password-reset/email-verification) was a
find-then-delete pair with a real race window — two concurrent requests presenting the same
still-valid token could both pass the SELECT before either DELETE ran; it's now a single
`DELETE ... WHERE ... RETURNING`, so only one concurrent caller can ever actually consume a given
token. `mergeGuestCartIntoCustomerCart` trusted its `guestCartId` argument outright — since a
guest cart's id is the *only* proof of ownership (read straight from a cookie), a forged or
guessed id naming a different customer's real cart would have been silently deleted and its items
moved onto the logging-in customer's own cart; it now re-resolves the id through `getGuestCart`
(which already filters `customerId IS NULL`) and no-ops if that fails. Adding an out-of-stock
(`stockQty === 0`) variant to a cart, and merging one across login, previously produced a
quantity-0 line instead of failing or being dropped — `addOrIncrementItem` now returns `null`
(the route turns that into a 400) and the merge loop now skips such a line entirely rather than
writing it. `POST /cart/items` also now rejects a variant whose `status` is `archived`, which
wasn't checked before at all.

Customer account deletion/anonymization is explicitly deferred — there's nothing yet (no orders)
a deletion could conflict with. Flagged for 2c/2d: once Orders exist, deleting a customer must not
corrupt order/payment records, which need their own snapshot of customer-identifying info
independent of the live row, for the same reason Order will snapshot product/price data (see the
`cart_items` cascade note above).

## Commerce (Phase 2c: checkout & orders) — done, 2026-09-08

Converts a cart (guest or customer) into a durable `Order`, with real, concurrency-safe stock
enforcement — closing the "cart-time stock capping is advisory only; real atomic stock enforcement
is Phase 2c's job at order creation" promise made in the 2b section above. Two new tables:
`plugin_commerce_orders` and `plugin_commerce_order_items` (migration `0027_thin_lily_hollister.sql`).
Money, address, and every line item are **snapshotted onto the order at checkout time** — never
joined live from the product/variant/customer/address rows — for exactly the reason flagged as
deferred in 2b: a customer can edit their name, delete an address, or (once implemented) be
deleted entirely, and a product's price/name can change, and none of that may ever alter what a
past order legally recorded. `customerId` is nullable and `customerEmail`/`customerName` are
always populated directly, because **guest checkout is supported** — requiring an account to buy
anything would be a real product regression given guest carts already exist, not a security
necessity, since the order never depends on a live customer row to know who it's for.

**Real stock enforcement, not just capping.** `createOrder` (`repository/orders.ts`) runs a
two-phase reserve-then-create sequence rather than a single write, because D1 has no
`SELECT ... FOR UPDATE`: phase one conditionally decrements every tracked-stock line in one
`db.batch()` (`UPDATE ... SET stock_qty = stock_qty - ? WHERE stock_qty >= ? RETURNING id` — a
`.returning()` per statement is how an insufficient-stock line becomes visible at all, since a
`WHERE` matching zero rows is not a SQL error D1's own batch atomicity would catch); if any line
failed, the lines that DID succeed are given back in a compensating batch before returning
failure, so a checkout that can't be fully satisfied never leaves other customers short on stock
it reserved but couldn't use. Only then does phase two insert the order, its items, and clear the
cart in a second batch. Verified with a real concurrency test, not just reasoned about: two
customers checking out the last unit of the same variant at the same time via `Promise.all`
resolves to exactly one 201 and one 400, and the variant's stock lands at exactly 0, never
negative. Known, accepted gap, documented in code rather than silently risked: a crash between
the two phases would leave stock decremented with no order to show for it — D1 has no
cross-request saga/compensation log, and building one is out of scope for this pass.

Checkout (`POST /checkout`, public, guest-or-customer cookie) re-verifies every cart line's
product/variant status live at checkout time (never trusting whatever was true when it was added
to the cart) and rejects the whole checkout — naming which item — if anything is no longer
published/active, rather than silently dropping it and charging for less than the cart showed.
Order status is a five-state machine (`pending -> paid -> fulfilled`, with `cancelled`/`refunded`
reachable from more than one state and both terminal) enforced in `updateOrderStatus`, not left to
the caller — an invalid transition 400s. Cancelling or refunding an order **restocks** every
line whose variant still exists (a deleted variant has nothing left to restock, and is skipped),
closing the other half of "real" stock enforcement: a cancellation must give back what it reserved
or every cancellation permanently shrinks available stock.

Three route surfaces: `POST /checkout` (public); `GET /customer/orders` +
`GET /customer/orders/{id}` (`routes/customer.ts`, session-required, 404s another customer's or a
guest order's id identically to a nonexistent one — the same draft-vs-nonexistent-slug convention
Core's own public API already establishes); and `GET`/`GET :id`/`PATCH :id/status` under
`/orders` (`routes/admin-orders.ts`, CMS-staff). Admin order routes are gated at `editor`, matching
catalog — not admin-customers.ts's stricter `admin` floor — since fulfilling orders (seeing what
was bought, where it ships, moving pending → paid → fulfilled) is core day-to-day operational work
for an editor, not customer-PII browsing. `checkout`/`customer`/`cart` all share one small
extraction, `lib/cart-resolution.ts`'s `resolveExistingCart` (pulled out of `routes/cart.ts`,
which used to define it locally), so checkout never duplicates cart.ts's own customer-vs-guest
cart resolution.

`apps/admin` gained an Orders page (list with a status filter, `DataTable`) and an Order detail
page (line items, shipping address, a status-change `Select` that lets the API's own transition
validation be authoritative rather than mirroring the state machine in the UI) — both under a new
`/plugins/commerce/orders` route pair, registered in `apps/admin/src/plugins/registry.ts` the same
way every other Commerce page already is. `StatusBadge` gained tone entries for all five order
statuses.

Verified with two new real-D1 test files: `commerce-checkout.test.ts` (8 tests — empty-cart/
missing-guest-contact-info rejection, a full guest checkout with stock decrement and cart-clear
assertions, a customer checkout defaulting email/name from the profile, rejection of a since-
unpublished item, rejection when stock dropped below the cart quantity in the meantime with the
stock level asserted unchanged, a failed multi-item checkout proving the successfully-reserved
line's stock is given back, and the concurrency race test described above) and
`commerce-orders.test.ts` (7 tests — the editor-floor role gate, list/filter/detail, valid and
invalid status transitions, restock-on-cancel with a second cancel attempt asserted to 400 since
cancelled is terminal, and customer order-history scoping including the cross-customer 404).
## Commerce (Phase 2d: payments/Paystack) — done, 2026-09-08

Converts a `pending` Order into `paid` via a real payment gateway, closing the last piece of
Commerce's core purchase flow — everything Phase 2c's checkout produced now has a way to actually
be paid for. Server-redirect flow only (Paystack's Initialize Transaction → hosted checkout page →
callback URL), deliberately not Paystack's inline/popup JS widget — this CMS is documented
frontend-agnostic (docs/ARCHITECTURE.md §15) and has no assumed frontend framework to embed a
widget into; the backend hands back an `authorization_url` and the storefront just redirects the
browser there.

**A real provider boundary, not a Paystack-shaped hole in the Commerce domain.** A new
`PluginContext`/`PluginPublicContext.payments: PluginPaymentsService` (`packages/plugin-sdk`) is
the interface Commerce's own route/domain code depends on — `initializeTransaction`/
`verifyTransaction`/`verifyWebhookSignature`, nothing Paystack-shaped in the signature. The actual
HTTP-calling implementation lives entirely in Core, not the plugin package:
`apps/api/src/lib/payments/{types,paystack,noop,index}.ts`, mirroring
`apps/api/src/lib/email`'s own provider-selection precedent exactly (`getPaymentProvider(env)`
picks Paystack if `PAYSTACK_SECRET_KEY` is set, else a noop provider whose methods throw/return
"not configured" — the email module's unset-is-fine convention, not OWNER_RECOVERY_SECRET's
zero-attack-surface 404 convention, since this is a feature-off switch, not a security backdoor).
`apps/api/src/plugins/context.ts` wires it into a plugin's context the same pass-through way
`createPluginEmailService` already does — a plugin never sees the secret key or picks a provider.
Paystack's own secret key doubles as its webhook-signing key (no separate webhook secret exists to
configure); signature verification is a local HMAC-SHA512 computation (`crypto.subtle`, the same
primitive `apps/api/src/lib/webhooks.ts`'s own outgoing-webhook signing already uses, just SHA-512
not SHA-256) compared via `constantTimeEqual` (`better-auth/crypto`, already this codebase's
standard for every other secret-comparison). `PAYSTACK_SECRET_KEY` is a Worker secret
(`wrangler secret put`), never a `plugin_settings`/database value or anything committed —
documented in `wrangler.toml` alongside `RESEND_API_KEY`/`OWNER_RECOVERY_SECRET`'s own entries.

**Server-authoritative, always.** The browser reaching the `callback_url` after Paystack's hosted
page proves nothing on its own — every order transition to `paid` requires this deployment's own
server-side call to Paystack's verify API (`GET /orders/{id}/verify`) or a signature-verified
webhook (`POST /webhook`), never the redirect itself. Both paths independently check the
provider's own reported `amount`/`currency` against the order's own `totalAmount`/`currency`
before ever transitioning it — a transaction that genuinely succeeded at Paystack for the wrong
amount is logged and left `pending` for manual investigation (`409` from the verify route) rather
than silently accepted or force-marked `failed`, an accepted, documented simplification rather
than a fourth ledger status invented for something that should never happen if initialize built
the request correctly.

**A real payment-attempt ledger, and real idempotency, not just a status field on Order.** A new
`plugin_commerce_order_payments` table (migration `0028_groovy_bullseye.sql`) records every
Paystack reference this deployment ever issues — starting `pending` the instant `POST
/orders/{id}/initialize` gets one back, before the customer has even reached Paystack's page — not
only the ones that succeed. Resolving a reference (`repository/payments.ts`'s
`resolvePaymentAttempt`) is a single `UPDATE ... WHERE reference = ? AND status = 'pending'
RETURNING *`, the same conditional-update-plus-check-returned-rows idiom this codebase already
uses for single-use tokens (`customer-tokens.ts`) and stock reservation (`createOrder`) — a
retried webhook delivery or a duplicate verify call for an already-resolved reference matches zero
rows and is a safe no-op, never a second order transition or a second ledger row. Tracking every
issued reference (not just the order's latest) also means a late webhook for an OLDER, still-
pending reference — the customer abandoned one attempt, retried, and paid on the second — still
resolves correctly rather than silently going unmatched. `GET /orders/{id}/verify` further checks
that the given reference actually belongs to the given order (looked up in the ledger, not merely
well-formed) before ever calling Paystack, closing off cross-order reference reuse. A genuine
double-payment for one order (a rare customer error, two separate references both succeeding) is
still an accepted, flagged gap — both get their own ledger row, but only the first can transition
an already-`paid` order — matching this codebase's own established practice of naming a small,
real edge left for a future pass rather than silently risking or over-engineering around it.

**Checkout idempotency (Phase 2c's own deferred gap, closed here first, before payments needed
it).** `POST /checkout` now requires a client-supplied `Idempotency-Key` header — a new
`plugin_commerce_idempotency_keys` table backs `repository/idempotency.ts`'s `claimIdempotencyKey`/
`completeIdempotencyKey`, using `.onConflictDoNothing().returning()` (not a plain INSERT wrapped in
try/catch — nothing else in this codebase catches a driver-specific constraint-violation error
shape, and this is deliberately consistent with that) so only one of two truly concurrent
identical submissions ever claims a given key; the loser sees `in_progress` (409, retry shortly) or
`completed` (replays the exact stored response) depending on timing. This closes the real race
Phase 2c left open: two concurrent requests for the same cart could previously both pass the
"cart still has items" check before either's `createOrder` batch committed, each decrementing
stock and creating its own order — verified with a real concurrency test (`Promise.all`, same
key), alongside a same-key sequential-retry test proving the second call replays the first's order
rather than 400ing on the by-then-already-cleared cart.

Three payments route surfaces, all public (checkout/payment confirmation must work for a guest —
authorization here is knowledge of the order id, an unguessable UUID, the same bearer-capability
model Phase 2b's guest cart id already established; `requireTrustedOriginForMutations` — a CSRF
defense specifically for cookie-authenticated mutations — doesn't apply and isn't used, since none
of these routes carry cookie-based identity to forge): `POST /orders/{id}/initialize` (validates
the order is `pending`, validates `callbackUrl` against this deployment's own `CORS_ORIGINS`
allow-list — closing off an open-redirect-adjacent primitive rather than accepting an arbitrary
attacker-chosen destination — then calls Paystack and records the pending ledger row);
`GET /orders/{id}/verify` (the server-authoritative confirmation path a storefront calls after the
callback redirect); `POST /webhook` (Paystack's own, signature-verified, deliberately outside
`.openapi()`'s validation like Core's own media-upload/form-submission precedent, since a
provider-defined payload isn't something this deployment's Zod schema validates — reads the raw
body text, not parsed-then-reserialized JSON, since signature verification needs the exact bytes
Paystack signed). Admin order detail (`GET /admin/.../orders/{id}`) now also returns the order's
full payment-attempt ledger, and the Order detail admin page shows it.

Verified with three new test files, all mocking rather than depending on a real Paystack account
(none available to this automated suite): `paystack-provider.test.ts` (8 tests, mocks `fetch` —
request-shaping, response-parsing, and a real HMAC-SHA512 signature computed by hand in the test
mirroring the provider's own algorithm, confirming both a valid and a tampered signature resolve
correctly) and `commerce-payments.test.ts` (12 tests, a hand-injected fake `PluginPaymentsService`
mounted on a standalone Hono app — mirroring `plugin-rate-limit.test.ts`'s own "test this route
file in isolation from the whole app" pattern — covering unconfigured/CORS-rejection/non-pending-
order rejection, a real initialize round trip, verify's success/mismatch/idempotent-replay paths,
and the webhook's signature rejection/idempotent-replay/ignored-event-type/unknown-reference
paths) plus the checkout-idempotency tests folded into `commerce-checkout.test.ts` (now 11 tests).
A real end-to-end pass against Paystack's actual test-mode sandbox (rather than a mocked
`fetch`/injected fake) is intentionally deferred to whenever real Paystack test credentials are
available to run it with — a manual verification step, not part of this automated suite, matching
how this project has handled a small number of other passes needing a real third-party credential
this environment doesn't have.

Storefront integration into `@kenresoft-cms/astro`/`examples/astro-site` (2e) — wiring the whole
cart → checkout → pay → verify flow into a real rendered storefront — remains **not started**.

## Commerce (Phase 2d review fixes) — done, 2026-09-08

A direct code review of the merged 2d work (not a fresh phase) found six real gaps, all closed
before 2e could start:

1. **Paystack status mapping.** `toTransactionStatus` and the routes consuming it originally
   collapsed every non-`success` status straight to `failed` — but Paystack has genuinely
   non-terminal statuses (`pending`/`ongoing`/`processing`/`queued`) and a `reversed` status for a
   charge reversed after the fact. `PaymentTransactionStatus` now carries Paystack's full
   vocabulary 1:1; `routes/payments.ts`'s verify handler only calls `settlePayment` for the two
   genuinely terminal outcomes (`success`, `failed`/`abandoned`) and leaves a payment attempt
   `pending` in the ledger for anything else, logging it as informational rather than guessing.
2. **Duplicate payment initialization.** A repeated `POST /orders/{id}/initialize` previously
   called Paystack again every time, creating a new chargeable reference each call. It now checks
   `getPendingPaymentAttemptForOrder` first and re-verifies that attempt's real status with
   Paystack: still in flight → reuse the same stored `authorizationUrl` (a new column on
   `plugin_commerce_order_payments`, set once at initialize time); genuinely failed → resolve it
   and issue a real fresh reference; already succeeded → reject (the order is no longer pending).
3. **Stale idempotency-claim recovery.** `claimIdempotencyKey` could leave a key permanently
   `in_progress` (409 forever) if the Worker crashed after claiming it but before
   `completeIdempotencyKey` ran. A claim older than `STALE_CLAIM_MS` (30s — generous for an I/O-
   bound checkout, and a false "still in progress" is harmless where reclaiming too early is not)
   is now reclaimable via the same conditional-update-plus-check-returned-rows idiom used
   throughout this codebase: bumping `createdAt` is simultaneously "I now own this key" and the
   guard against a second concurrent reclaimer also succeeding.
4. **`refunded` was never real.** The pre-fix `paid`/`fulfilled -> refunded` transition changed
   the CMS status and restocked inventory without ever calling a Paystack refund API — an order
   could read "refunded" while no money had moved. No transition reaches `refunded` now (the
   status value itself stays defined, for a future pass that implements real provider-backed
   refunds); the admin Order detail page no longer offers it as an option.
5. **Cancellation-vs-payment race, given an explicit policy.** If an order is cancelled while its
   Paystack transaction is still pending, and Paystack later reports `charge.success` for it, the
   order's CMS status must never be silently overwritten — `resolvePaymentAttempt`'s own
   conditional `UPDATE ... WHERE status = 'pending'` already made this safe at the DB level (the
   order stays cancelled); `settlePayment` (`routes/payments.ts`) now explicitly detects this case
   (`orderTransitionedToPaid: false` on an otherwise-successful resolution) and logs it loudly for
   manual reconciliation, since real money moved for an order this deployment no longer considers
   open and provider-backed refunds aren't implemented yet (see point 4). The payment is still
   recorded as a genuine success in the ledger — never silently dropped.
6. Tests for all of the above: `paystack-provider.test.ts` gained full coverage of Paystack's
   status vocabulary (was 8 tests, still 8 — the existing status test was extended, not
   duplicated); `commerce-payments.test.ts` grew from 12 to 22 tests (non-terminal statuses via
   `it.each`, terminal failures via `it.each`, three duplicate-initialization tests, and the
   cancellation-race test asserting the order stays cancelled, the payment still resolves to
   `success` in the ledger, and `logger.error` fires with the right detail); `commerce-checkout
   .test.ts` grew from 11 to 13 (stale-claim reclaim, and a fresh-claim-is-NOT-reclaimed control
   test); `commerce-orders.test.ts` grew from 7 to 8 (both `fulfilled -> refunded` and
   `paid -> refunded` directly rejected). Full re-verification: clean `pnpm typecheck`/`pnpm lint`
   workspace-wide, all commerce/payments test files passing individually, the full `apps/admin`
   suite (162 tests) clean in one run.

## Commerce (Phase 2d review fixes, round 2 — concurrency) — done, 2026-09-08

A second direct review of the merged review-fix round found the first round's own two remaining
gaps were still check-then-act races, not durable database guarantees:

1. **Payment initialization race.** `getPendingPaymentAttemptForOrder` followed by a separate
   insert was still a genuine TOCTOU race — two concurrent `POST /orders/{id}/initialize` calls
   could both observe no pending attempt before either had inserted one, and both proceed to call
   Paystack. Fixed with a new `plugin_commerce_order_payments_one_pending_per_order_idx` — a
   **partial unique index** (`WHERE status = 'pending'`) enforced by SQLite itself, not
   application logic. `claimPendingPaymentAttempt` (`repository/payments.ts`) now generates the
   reference and reserves the row via `.onConflictDoNothing().returning()` *before* Paystack is
   ever called; only one of two truly concurrent claims can win. The loser never calls Paystack —
   it inspects whatever attempt did win (re-verifying it with Paystack) and either reuses it,
   waits, or (if that one just resolved as failed) claims a genuinely fresh slot itself. A
   provider error after a successful claim is handled by `abandonPaymentAttempt`, freeing the slot
   rather than leaving a dead `'pending'` row blocking the order forever.
2. **Checkout idempotency's stale-claim recovery wasn't sufficient on its own.** The first
   round's 30s stale-claim reclaim (`repository/idempotency.ts`) is itself atomic — but atomicity
   of *reassigning* a claim does nothing to stop the *original* request (merely slow, not
   crashed) from continuing to run. Two executions could therefore both reach `createOrder` for
   the same key. Fixed with a durable, DB-enforced invariant one level down, independent of that
   table's own timing entirely: a new `idempotencyKey` column on `plugin_commerce_orders`,
   UNIQUE, populated from `POST /checkout`'s own required header. `createOrder`
   (`repository/orders.ts`) now inserts the order row itself via
   `.onConflictDoNothing().returning()` against this constraint, as its own standalone step
   *before* inserting items or deleting the cart — deliberately not folded into the same batch,
   since a conflicting order insert combined with item inserts referencing it would trip the
   items' own FK constraint and abort the whole batch instead of behaving predictably. A losing
   execution gives back whatever stock it speculatively reserved and returns the **winner's**
   order (looked up by `idempotencyKey`) instead of creating a second one — so even the two
   executions the stale-claim reclaim doc explicitly permits can never produce two orders. The
   claim/reclaim table is kept exactly as-is: an availability mechanism (nothing gets stuck
   forever) and a response-caching fast path, not the correctness guarantee — that job now belongs
   entirely to the database constraint.
3. Two new, genuine concurrency tests (both using real `Promise.all`, not simulated): `commerce-
   payments.test.ts` gained a test asserting Paystack's `initializeTransaction` is called exactly
   once across two simultaneous `POST /orders/{id}/initialize` calls for the same order (22 → 23
   tests); `commerce-checkout.test.ts` gained a test calling `createOrder` directly, twice
   concurrently with the same `idempotencyKey` but two independent carts — deliberately bypassing
   the claim-table entirely to isolate and prove the new DB-level invariant specifically — asserting
   exactly one order results, both callers receive the identical order, and the losing cart's
   speculative stock reservation is correctly given back (13 → 14 tests).

Full re-verification: clean `pnpm typecheck`/`pnpm lint` workspace-wide, every commerce/payments
test file passing individually, the full `apps/admin` suite (162 tests) clean in one run.

## Commerce (Phase 2d review fixes, round 3) and CI stabilization — done, 2026-09-08

A third review found four more gaps in the checkout/payments concurrency work, all closed, plus
two unrelated CI-stability issues found while landing them.

1. **Checkout partial-state race.** `createOrder` inserted the order row as its own standalone
   statement, separate from the item-insert/cart-delete batch — a losing concurrent execution (or
   a crash) could leave an order observably existing with zero items. Fixed by folding the order
   insert, every item insert, and the cart delete into ONE atomic batch: a losing execution's
   order insert is skipped by `.onConflictDoNothing()`, so its own item inserts (which reference
   its own `orderId` via a NOT NULL FK) violate that foreign key, aborting the whole batch — caught
   and handled exactly like the prior "lost the race" path (give back stock, return the winner's
   order). A winning execution's order, items, and cart-delete now commit together or not at all.
2. **Orphaned payment claim, made safe against a still-running (not dead) original request.**
   `reclaimStaleUnauthorizedAttempt` (a 30s-stale, no-`authorizationUrl` claim) originally flipped
   `status` to `'failed'` — safe only if the claiming request had actually crashed. If it was
   merely slow and later called back into `resolvePaymentAttempt` with a genuine success, that
   function's `WHERE status = 'pending'` conditional UPDATE would no longer match, silently
   stranding a real payment. Fixed with a new `reclaimed_at` column (migration `0031`) and a
   changed partial unique index — `WHERE status = 'pending' AND reclaimed_at IS NULL`. Reclaiming
   now only sets `reclaimed_at`, freeing the slot for a fresh claim without ever touching `status`,
   so a late-but-genuine resolution from the original request still transitions the order
   correctly. Verified directly: a stale claim is reclaimed for a fresh attempt, then the
   *original* reference resolves for real via webhook, and the order still ends up `paid`.
3. **Migration safety for pre-existing duplicate data.** The partial unique index from the prior
   round's own fix (`plugin_commerce_order_payments_one_pending_per_order_idx`) would fail to
   create on any database that had already run the pre-fix racy claim code and accumulated more
   than one `'pending'` row for the same order. Migration `0030` now runs a defensive cleanup
   `UPDATE` first — keeping the most recent pending attempt per order, marking older duplicates
   `'failed'` (never deleting the ledger row) — before creating the index. Verified with a
   dedicated test that reproduces the violation and proves both the cleanup and the index creation
   succeed against real, deliberately-dirtied data.
4. **Payment authority.** `PATCH /orders/{id}/status` (admin/editor) allowed setting an order
   straight to `'paid'` by hand — a real financial-integrity gap, since payment settlement is
   supposed to be exclusively driven by a real Paystack verify/webhook. `VALID_TRANSITIONS`
   (`repository/orders.ts`) no longer includes `pending -> paid`; only `resolvePaymentAttempt`'s
   own direct, atomic update (bypassing this transition table entirely) can make that move.

Landing this surfaced two unrelated CI-only issues, both fixed the same pass: `apps/api`'s CI job
ran its full ~39-file suite as one unbatched `vitest run`, contending hard enough on GitHub's
shared runners to produce real, non-code failures (timeouts, spurious 500s) — `fileParallelism:
false` plus a raised `testTimeout`/`hookTimeout` (20s) in `vitest.config.ts` fixed it, the same
"stop running everything at once" fix this project's own local dev practice already uses by hand.
Separately, a test that looked like a genuine "both requests got 409" race turned out to be a
latent bug in the test's own assertion: `[status, status].sort()` sorts as **strings** with no
comparator, so `"409"` always sorts after `"201"` — the assertion could never pass whenever either
response was genuinely 409, even though the test's own comment already documented that as
acceptable. Confirmed via temporary debug logging on a throwaway CI branch (a "both literally 409"
branch never fired); fixed by comparing with `includes()`/`every()` instead of `.sort()` position.

## Commerce (Phase 2e: storefront integration) — done, 2026-09-08

Wires the whole cart → checkout → pay → verify flow into a real rendered storefront, closing the
last item this document's own status line had tracked as not started. Two pieces: a real gap found
in the public catalog API while building this (fixed first), and the actual client/storefront work.

**Public catalog gap: product detail had no images or variants.** `GET .../public/v1/products`
(list) and `.../products/{slug}` (detail) had shipped in Phase 2a with neither — meaning no
storefront could ever have rendered a product photo or a size/color picker, full stop, regardless
of how the client or storefront code was written. Fixed by extending the **detail** route only
(`routes/public.ts`): `images` (id, mediaId, altText, sortOrder) and `variants` (active only —
archived variants are filtered out the same way `cart.ts`'s own add-to-cart check already treats
them, since they're never orderable). The **list** route deliberately stays lean, still no images/
variants — fetching every product's images/variants for a grid view one click away from the detail
page that already has them would mean an extra query per row for data that view doesn't need.
Verified with a real test: a product with one active and one archived variant, plus a real
uploaded-and-associated Core media image, confirms the detail response includes exactly the active
variant and the image, and confirms the list response carries neither field.

**`@kenresoft-cms/astro` gained a `commerce` client namespace** (`integrations/astro/src/index.ts`)
— categories/products (list/get), cart (get/addItem/updateItem/removeItem/clear), checkout
(submit), and payments (initialize/verify). Types are hand-mirrored from the plugin's own Zod
route schemas, not imported — `packages/plugin-ecommerce` isn't published to npm (unlike
`@kenresoft-cms/contracts`), so there's nothing to import from outside the monorepo. Every
commerce call sets `credentials: 'include'`: cart identity is a cookie the API sets directly on
its own origin, which a storefront's own origin must be present in that deployment's
`CORS_ORIGINS` to send/receive at all (docs/PLUGINS.md's Phase 2b CSRF section already covers why).
`products.get()` follows `entries.get()`'s own "404 -> null" convention; every mutating call throws
`KenresoftApiError` on a non-2xx response, matching the rest of this client.

**Deliberately guest-only for this pass** — customer account registration/login, order history,
and saved addresses aren't wired into the client yet. This isn't a stopgap: guest checkout is
already Commerce's own complete, independently-supported purchase path (Phase 2b/2c's own design),
so shipping a real, working guest storefront now and layering account features in as a genuine
follow-up is the same "ship the real thing, flag the rest" pattern this document uses throughout,
not scope cut for its own sake.

**`examples/astro-site` gained a real storefront**: `/shop` (SSR product grid), `/shop/[slug]`
(SSR product detail — images, a variant picker with live price updates, an add-to-cart form),
`/cart` (client-rendered — cart identity is a browser cookie, which server-side Astro frontmatter
has no natural way to receive and hand back to the browser without manually proxying `Set-Cookie`
through `Astro.cookies`, so every cart/checkout/payment mutation in this example runs client-side
via a `<script>` importing `@kenresoft-cms/astro` directly, not in SSR frontmatter — the same
pattern any other frontend framework consuming this frontend-agnostic API would use), and
`/order/[id]` (the payment `callbackUrl` target — reads Paystack's own `?reference=` query param,
calls `payments.verify()`, and shows the order's real, server-confirmed status). The checkout flow
handles the no-payment-provider-configured case explicitly rather than leaving it broken: if
`payments.initialize()` 503s, the confirmation renders inline from the checkout response already
in hand, since there's no public "get order by id" endpoint to re-fetch a guest's order from
otherwise (by design — a guest order's id is a bearer capability, not something a plugin needlessly
exposes a lookup route for, matching this document's own guest-cart-id reasoning in 2b).

Verified live, end-to-end, against a real local API instance (dedicated port, isolated D1
persist-to path — never a developer's own `wrangler dev` state) and a real headless-Chromium
browser (Playwright), not just `astro check`/a build: seeded a real product with a variant via the
admin API, confirmed the public detail endpoint returns it correctly, then drove the actual
rendered pages — shop listing shows the product, the detail page's variant selector updates the
displayed price live, add-to-cart succeeds, the cart page shows the added item and a quantity
update sticks, and submitting checkout (on an instance with no `PAYSTACK_SECRET_KEY` configured,
deliberately, since no real Paystack credentials are available to this environment) correctly
falls through to the inline confirmation rather than breaking. Zero unexpected console errors —
the one 503 logged is the deliberate payments-unconfigured path being exercised, not a bug.

## Paystack developer status UI — done, 2026-09-09

A developer-experience-only pass, not a change to how payments/secrets actually work: an operator
setting up (or troubleshooting) a deployment previously had no way to check whether
`PAYSTACK_SECRET_KEY` was actually set, or whether it was a test or live key, short of reading
source or trying a real checkout. Closed with one additive method on the existing provider
boundary, never by loosening it.

`PaymentProvider`/`PluginPaymentsService` (`apps/api/src/lib/payments/types.ts`,
`packages/plugin-sdk/src/context.ts`) both gained `getStatus(): { configured: boolean;
environment: 'test' | 'live' | 'unknown' }` — local, synchronous, no network call. The Paystack
implementation (`paystack.ts`) derives `environment` purely from which of Paystack's two
documented prefixes (`sk_test_`/`sk_live_`) the already-in-hand secret starts with; the noop
implementation (`noop.ts`) always reports `{ configured: false, environment: 'unknown' }`. Neither
implementation, nor the new route below, ever returns the key itself or anything derived from more
than its own prefix — `getStatus()` exists specifically so a plugin (or this admin UI) never needs
to see the credential to answer "is this set up." `apps/api/src/plugins/context.ts`'s
`createPluginPaymentsService` needed no change at all — it already passes `PaymentProvider`
through to `PluginPaymentsService` verbatim, and the two interfaces are still identical shapes.

New `GET /api/plugins/commerce/v1/settings/payment-status` (`packages/plugin-ecommerce/src/routes/
settings.ts`, same no-role-gate treatment as the existing settings `GET /`, since this is a
read-only, non-sensitive status readout, not a mutation) calls `ctx.payments.getStatus()` and
returns exactly `{ provider: 'Paystack', configured, environment }` — nothing else, by
construction (the response schema is a closed Zod object, not a passthrough of whatever the
provider returns).

`apps/admin`'s Commerce Settings page (`apps/admin/src/plugins/commerce/SettingsPage.tsx`) gained
a new Paystack section (`PaystackSection.tsx`): a "Verify configuration" button that calls the new
endpoint on demand (not fetched automatically on page load, since this is meant as an explicit
check, not ambient page data) and renders Not configured / Configured badges, an
environment-specific banner (a plain informational note for test, a visually distinct
destructive-toned warning for live — "real transactions will be processed"), copy-pasteable
`.dev.vars`/`wrangler secret put PAYSTACK_SECRET_KEY` setup snippets, and the deployment's own
webhook URL (`${API_URL}/api/plugins/commerce/public/v1/payments/webhook`, derived from the
admin app's existing `API_URL` — never a hardcoded domain) with a copy-to-clipboard button, plus
links out to Paystack's dashboard and docs. The page never has a field that accepts a secret or
public key of any kind — setup instructions are shown as plain text/code blocks, matching this
integration's server-redirect-only design (no inline/JS widget ever needs a public key at all).
When not configured, the page explains plainly that Commerce still works — catalog/order
management is unaffected — only payment initialization is disabled until a key is set, matching
`PaymentProvider`'s own existing "not configured" convention rather than treating it as an error.

`docs/DEPLOYMENT.md` gained a "Commerce: configuring Paystack (optional)" section (see there) so
this is documented for a fresh deployment without needing to read source or find this admin page
first.

Verified live against a real, isolated `wrangler dev` instance (dedicated `--persist-to`
path/port, killed and confirmed via `netstat`/`taskkill` before starting, per this project's own
standing Windows note that a background task's shell id doesn't reliably kill the underlying
`workerd`/`node` tree): with `PAYSTACK_SECRET_KEY` unset, both the API route and the admin UI
correctly show "not configured"; setting a fake `sk_test_...` value in that isolated instance's
own `.dev.vars` flips the response to `{ configured: true, environment: 'test' }` and the UI shows
the test-mode banner; setting a fake `sk_live_...` value flips it to `environment: 'live'` and the
UI shows the live-transactions warning. The actual HTTP response body was inspected directly for
every case (not just the rendered UI) to confirm it never carries anything beyond
`provider`/`configured`/`environment` — no key, no prefix, no length, nothing key-shaped. New
tests: `paystack-provider.test.ts` gained `getStatus()` coverage for the noop provider and both
Paystack key prefixes plus an unrecognized-prefix case (`unknown`); a new
`commerce-payment-status.test.ts` exercises the real route end-to-end against real D1 (session
required, and the response's own key set asserted to be exactly `{configured, environment,
provider}`).
