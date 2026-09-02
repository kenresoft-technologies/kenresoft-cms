# Kenresoft CMS — Architecture & Technical Specification

Version 0.8 — Foundation Specification
First production target: Pathvera Group website
Vision: Cloudflare-native, API-first, reusable, scalable, open-source-ready CMS
Status: Proposed / Ready for implementation

## Changelog

**v0.11 (2026-08-28)** — Adds the account-recovery mechanisms v0.10 deliberately deferred:
password reset via email, recovery codes, and two independent owner-recovery paths for a fully
locked-out deployment — all designed so Kenresoft itself never holds any credential, secret, or
back door into a deployment (§11 restates why). **Password reset** is a bespoke pair of routes
(`POST /api/v1/public/password-reset/{request,confirm}`) reusing better-auth's own
`verification` table rather than its built-in reset flow, which stores the raw token in
plaintext (confirmed against the installed better-auth dist) — this stores only a SHA-256 hash,
one live token per user, 1-hour expiry, single-use, and `request` always returns the same
generic message regardless of whether the email matched an account, so the flow can't be used to
enumerate who has an account here. Confirming resets the account's credential (hashed with
better-auth's own `better-auth/crypto` scrypt implementation, matching what sign-in verifies
against) and signs out every existing session for that user. **Email** is a small provider
abstraction (`apps/api/src/lib/email/`) selected per-deployment via `EMAIL_PROVIDER` — Cloudflare
Email Service (`SendEmail` binding) or Resend (a plain REST call, no SDK dependency) — with a
`noop` sender as the default, which logs instead of sending so a fresh clone or `pnpm dev` needs
zero email setup to keep working. **Recovery codes** (`packages/database/schema/
recovery-codes.ts`) are an owner-generated, self-service fallback for "forgot my password *and*
lost my email" — ten single-use, hashed-at-rest codes, shown in the `apps/admin` UI exactly once
at generation and never again, redeemable without authentication via
`POST /api/v1/public/recovery/redeem` (email + code + new password, generic error on any
mismatch). Generating a fresh batch always fully replaces the previous one, which doubles as
"revoke"; a separate revoke-only action clears the set without minting new codes. Both
generating and revoking are Owner-only and require the same elevation (`requireElevatedSession`)
ownership transfer already uses — a valid code can reset the account's password with no email
access at all, so it's exactly as sensitive as changing the password directly. **Owner
recovery** covers the case where the Owner has neither their password nor email access: (a)
`apps/api/scripts/recover-owner.mjs`, an operator-run CLI that shells out to `wrangler d1
execute` (never a database driver of its own) and hashes a new password with `better-auth/
crypto` directly — deliberately never accepts the new password as a CLI argument (shell-history/
`ps`-visible), always prompting for it; and (b) a break-glass HTTP endpoint
(`POST /api/v1/system/recover-owner`) gated by an `OWNER_RECOVERY_SECRET` Worker secret that is
**absent by default everywhere** — the route 404s outright, indistinguishable from a route that
doesn't exist, unless an operator explicitly opts in with `wrangler secret put
OWNER_RECOVERY_SECRET`. Both owner-recovery paths, plus password-reset and recovery-code
redemption, share one conservative rate limiter (`RECOVERY_RATE_LIMITER`, 3/60s per IP) — tighter
than every other limiter in this API, since a successful hit against any of them changes a
password. Every credential mutation from this pass is audited through the existing
`apps/api/src/lib/audit.ts` helper (`password.reset`, `recovery-codes.generated`,
`recovery-codes.revoked`, `owner.recovered`).

**v0.10 (2026-08-28)** — Introduces a real **Owner** role above Admin (§10), representing
ownership of this specific installation rather than any Kenresoft/external account — prompted
by a request to make sure a normal Admin can never lock the actual owner of a deployment out of
their own CMS. `USER_ROLES` gains `'owner'` (`packages/database/migrations/
0013_promote_oldest_admin_to_owner.sql` promotes the oldest existing admin on upgrade; the
`auth.ts` bootstrap hook grants it to the first-ever signup on a fresh install) and
`packages/contracts/schemas/enums.ts` gains `ROLE_RANK`/`roleAtLeast()` — a five-level hierarchy
(`owner > admin > editor > author > viewer`) that replaced ~19 hand-copied exact-role-string
comparisons across `apps/api`/`apps/admin` with a single ranked check, so `owner` transparently
satisfies every existing `requireRole('admin')` gate without touching those call sites. Two new
invariants, enforced by `apps/api/src/lib/user-guards.ts` and applied to every user-management
route (`PATCH .../role`, `DELETE .../users/:id`, the new `PATCH .../disabled`): an owner can
never be demoted, deleted, or disabled through those routes by anyone (role/ownership changes
*to or from* owner only happen via Transfer ownership below), and no change may leave the
deployment with zero owners *and* zero admins combined (`countGuardians`, generalized from the
old admin-only count — an owner alone is enough to keep a deployment manageable, so demoting the
sole admin while an owner exists is now correctly allowed, where it was previously blocked as
"last admin"). Disabling is new — previously delete-only — via a `user.disabled` field
(better-auth `additionalFields`, checked in `requireSession` and enforced by revoking every
session for that user immediately, not just waiting for their next request). Disabling an
*admin* additionally requires a fresh password re-check: `POST /api/v1/admin/security/elevate`
verifies the caller's password via better-auth's own `verify-password` endpoint and marks the
current session row elevated for 5 minutes (`session.elevatedUntil`, also a new
`additionalField` — deliberately not better-auth's own session-freshness concept, which is a
~24h activity window, not "just re-entered your password"); `requireElevatedSession`
(`apps/api/src/middleware/require-elevated-session.ts`) gates on it. **Ownership transfer**
(`POST /api/v1/admin/security/ownership/transfer`) is owner-only and elevation-gated: a single
atomic swap (caller becomes admin, target becomes owner) rather than a grant, so the invariant
above is preserved by construction with no separate check needed — multiple simultaneous owners
aren't supported yet, but `checkGuardianRemains`/`checkNotTargetingOwner` don't assume exactly
one, so that's a future addition to the transfer endpoint, not a rework of the guards. A new
`audit_log` table (`packages/database/schema/audit-log.ts`) records role changes, disabling, and
ownership transfers (actor, target, action, non-secret metadata — `apps/api/src/lib/audit.ts` is
the one place rows get written, so "never log a password/token" stays a single rule to hold
rather than one per call site). The `apps/admin` Users page marks the owner with an immutable
badge and hides destructive actions on that row; Settings → Users & Permissions gained the
ownership-transfer control (owner-only, its own re-authentication dialog) and updated role-model
copy. **Not yet built** (a deliberately separate follow-up): password recovery via email,
recovery codes, and the emergency owner-recovery mechanisms for a fully locked-out deployment —
this pass is the ownership/authorization model itself, which has no dependency on any of those.

**v0.9 (2026-08-28)** — Expands authorization (§10) from the initial two-role Owner/Editor set
to four fixed roles — **Admin**, **Editor**, **Author**, **Viewer** — prompted by real usage
feedback that two roles couldn't express "can create content but shouldn't touch structure or
other people's work" or "read-only access for stakeholders." `Owner` is renamed to `Admin`
(same privileges: everything, including structure, users, roles, settings, and cache) via a
data-only Drizzle migration (`packages/database/migrations/0011_rename_owner_role_to_admin.sql`)
rather than a schema change, since the `role` column was already a plain string. `Editor` keeps
its existing scope (any entry, form submission triage, media, and now content-type/form field
management too — previously ungated). Two new roles: **Author** can create entries freely but
may only edit or delete entries they themselves created (`canWriteEntry()` in
`apps/api/src/routes/admin/entries.ts` checks `entry.createdBy` against the acting user, 403 on
mismatch; read access stays unrestricted — only writes are ownership-scoped) — no access to
media, forms, or structure. **Viewer** is read-only everywhere: a global
`blockViewerMutations` middleware (`apps/api/src/middleware/block-viewer-mutations.ts`) rejects
every non-GET/HEAD request under `/api/v1/admin/*` for that role in one place, rather than
threading a viewer check through each route individually. Session monitoring (the D1 `session`
table was already populated by better-auth but never surfaced) is now exposed to admins:
`GET /api/v1/admin/users/:id/sessions` and `DELETE .../sessions/:sessionId`
(`apps/api/src/repositories/sessions.ts`) — revocation is a plain row delete, not better-auth's
heavier admin plugin, deliberately avoided per an existing code comment. The `apps/admin` Users
page got a corresponding rebuild: stat cards (total/active/administrators/active-this-week,
all derived from data already in the list response — no new aggregate endpoint), role and
activity-status filters, a per-row sessions dialog with revoke, and a client-side CSV export —
prompted directly by a side-by-side comparison against Pathvera's current SonicJS deployment,
which this CMS is built to eventually replace (see the Changelog's v0.1 framing).

**v0.8 (2026-08-27)** — Closes the public-media gap the v0.7 Astro work surfaced but didn't
fix: a new unauthenticated `GET /api/v1/public/media/:id/file` (§14), mounted before the
generic `/api/v1/public/:contentType` catch-all (same ordering reason `/public/forms` already
needed — "media" would otherwise parse as a content-type slug). Edge-cached via the Cache API
for a year (media is immutable — no edit endpoint) and explicitly invalidated when the admin
DELETE route runs, mirroring the entry-cache invalidation discipline already in place. Added
`media.url({ id })` to `@kenresoft-cms/astro` (pure URL construction, no fetch) and wired
`examples/astro-site` to render a featured image when a `media`-type field is present —
falling back to the entry's title for `<img alt>` since Media's real `altText` still isn't
exposed publicly (a separate, smaller, deliberately-undecided question — see `docs/ASTRO.md`).
Two other things intentionally left alone rather than silently built: a public
content-type-metadata endpoint, and SSR/webhook revalidation for the Astro example — both
real product decisions, not defects, flagged as open in `docs/ASTRO.md` rather than resolved
unilaterally.

**v0.7 (2026-08-27)** — Phase 8's local Astro integration (§15/§20), scoped strictly to local
development per the phase boundary — no production deployment attempted or claimed.

- **`@kenresoft-cms/astro`** (new `integrations/astro/` workspace package) — a typed client
  (`createKenresoftClient`) wrapping the public API's two entry routes
  (`entries.list`/`entries.get`). Deliberately thin: no `contentTypes.list()`, since the public
  API has no content-type-metadata endpoint to back one (only the admin API does). Types come
  from `@kenresoft-cms/contracts`' `Entry` via a type-only import, so they're erased at compile
  time and never pull zod into a consumer's runtime bundle — same discipline as the zod-bundle
  lesson recorded in the v0.6 entry below, applied to a new package.
- **`examples/astro-site`** rebuilt on top of that client (previously a hand-rolled `fetch`
  wrapper) — verified end-to-end against a real local deployment: created a draft entry via the
  admin API, confirmed the public API 404s it, published it, confirmed the public API and
  `astro dev` both serve it immediately, edited it, confirmed a previously-built static `dist/`
  correctly still shows the pre-edit content, then confirmed a rebuild picks up the edit.
- **Repository structure change**: `pnpm-workspace.yaml` now includes `integrations/*` and
  `examples/*` (previously only `apps/*`/`packages/*`). `examples/astro-site` had briefly been
  kept deliberately outside the workspace (needing `pnpm install --ignore-workspace`) to mimic
  an external consumer with no monorepo access — reversed once `@kenresoft-cms/astro` existed and
  needed a real, friction-free consumption path from that example; a real SDK's own example app
  living in the SDK's own monorepo is the standard pattern, and preserving the workaround past
  the point it served a purpose would have been awkward tooling for its own sake.
- **New `docs/ASTRO.md`** — the full guide (architecture, local dev, environment variables,
  static-vs-SSR rationale, known limitations, future work). §15 below is now a summary pointing
  to it rather than the sole source.
- **Known gap surfaced by this work, not yet fixed**: there is no public, unauthenticated route
  for serving R2-backed media files (only the admin-gated `GET /api/v1/admin/media/:id/file`
  exists), so a `media`-type field can't be rendered by any public consumer — Astro or
  otherwise — yet.

**v0.6 (2026-08-27)** — Completes Phase 6's last item: `packages/contracts` is populated and
`apps/api` fully migrated to `@hono/zod-openapi`, closing the largest concrete gap found in a
product-direction audit (Kenresoft CMS is no longer scoped as "Pathvera's CMS" but as a
reusable, eventually open-source platform other developers would adopt — see the roadmap
framing in §2 and the non-goals in §19, both of which already anticipated this).

- **API contracts (§8)** — every route's request/response Zod schema now lives in
  `packages/contracts/schemas/*.ts`, the single source of truth shared between `apps/api`
  (runtime validation) and `apps/admin` (TypeScript types, zero runtime cost). Deleted
  `apps/api/src/validators/` and its hand-rolled `parseJsonBody` helper entirely. Two routes
  — media upload (multipart, validated by sniffing file bytes) and public form submissions
  (validated dynamically per-form) — don't fit a static request schema and stay outside
  `.openapi()`'s validation, but are still registered for documentation via
  `openAPIRegistry.registerPath()` so the generated doc stays complete.
- **Generated OpenAPI document and reference UI** — `GET /api/v1/openapi.json` and a Scalar
  reference page at `GET /api/v1/docs` (chosen over Swagger UI for a more premium/modern
  presentation, matching the product's developer-experience bar). Required a scoped CSP
  exception for exactly the `/docs` path — the security-headers middleware's strict
  `default-src 'none'` (§9) otherwise blocks Scalar's own assets outright.
- **Architectural lesson worth recording** — a `packages/contracts` schema file that defines
  both a plain runtime-value enum array and Zod schemas built from it cannot be safely
  tree-shaken: Rollup can't prove a third-party `z.object(...)` call is side-effect-free, so
  importing just the enum still pulls the whole module (zod included) into any bundle that
  imports it. Runtime-value enums now live in `packages/contracts/schemas/enums.ts` with zero
  zod import, and `apps/admin` imports that file via an explicit `exports` subpath
  (`@kenresoft-cms/contracts/schemas/enums`) rather than the package's main barrel, which still
  entangled things even after the enums moved out. Confirmed by grepping the built admin
  bundle for `ZodError`/`ZodObject`/`ZodType` before and after the fix.

**v0.5 (2026-08-26)** — Removed the multi-tenant/shared-installation assumption. Kenresoft
CMS is now a **single-site-per-deployment** CMS: every deployment (its own Cloudflare
account, D1 database, R2 bucket, Worker) backs exactly one website, deployed from the same
open-source codebase rather than run as a shared installation serving multiple clients from
one running instance. Decided after review surfaced two problems with the shared-tenant
model this document previously left open (old §11): (1) it is incompatible with handing a
finished site fully off to a client to run independently, since a shared installation would
still hold other clients' data alongside theirs; (2) `project_id`-scoped queries introduce a
real cross-tenant data-leak risk class — one missing filter in one repository or route leaks
another tenant's content — that a fully isolated deployment removes by construction instead
of by convention.

- **Domain model (§6)** — removed the `Project` entity and every `project_id` foreign key.
  Reusability is preserved at the codebase level (fork/redeploy the same open-source project
  to a new Cloudflare account per site) rather than at the running-instance level. The
  `Setting` entity added in v0.4 is renamed `Settings` and is now a **singleton per
  deployment** (name, contact email, social links, CORS origin, feature flags) rather than
  scoped to a project, since there is no longer a project to scope it to.
- **Deployment model (§11)**, retitled from "Multi-Client / Multi-Tenant Strategy" to
  "Deployment Model: Single Site Per Instance" — now documents the single-site-per-instance
  model directly (fork/clone → provision that client's own Cloudflare resources →
  `wrangler deploy`), rather than hedging between a shared D1 database and per-tenant
  databases.
- **API routes (§8)** — public content routes no longer take a `:project` path segment
  (`GET /api/v1/public/:contentType` instead of `GET /api/v1/public/:project/:contentType`);
  the admin `GET /api/v1/admin/projects` route is removed.
- **Non-goals (§19)** — added "operating a shared multi-tenant hosting service for multiple
  clients from one running installation" as an explicit non-goal, so this isn't silently
  reopened later.
- **Scalability (§12) and risk table (§23)** — `project_id`-based sharding language removed;
  every deployment is already a single-tenant database by construction, not a scaling
  technique applied within a shared one.

**v0.4 (2026-08-26)** — Three gaps identified from a SonicJS feature comparison during Phase 3
admin UI work.

- **Domain model (§6)** now includes a **Setting** entity — key/value configuration scoped to
  a project (contact email, social links, feature flags), editable from the admin UI without a
  redeploy. This was already implied by the Settings box in §11's multi-tenant diagram but
  never captured as a real entity.
- **Scalability (§12)** and **Phase 6** now specify a caching layer in front of the public
  content API — the Cloudflare Cache API for edge caching, with Workers KV as a read-through
  cache for content needing cross-colo consistency or longer TTLs, invalidated on publish/
  unpublish (§13) rather than left to expire blindly. D1 is single-threaded and had no cache
  story documented anywhere before this.
- **Content Lifecycle (§13)** and **Phase 4** now include optional scheduled publishing: a
  nullable `publishAt` timestamp on Entry, with a Cloudflare Cron Trigger periodically
  transitioning entries whose `publishAt` has elapsed to Published.

**v0.3 (2026-08-26)** — Two gaps identified by reviewing `FORK-CHANGES.md` from a prior
Hono+D1+Workers CMS project (flarecms, a SonicJS fork) before archiving it. That project had
to cherry-pick both of these in as post-hoc security patches after shipping without them —
cheaper to build in from the start here.

- **Security Architecture (§9)** now explicitly names a **CORS allow-list** (never default
  to `*`) and a **security headers middleware** (CSP, `X-Frame-Options`,
  `X-Content-Type-Options`, HSTS, `Referrer-Policy`, `Permissions-Policy`) as required
  controls, rather than leaving them implied by "established technologies."
- **Migrations pipeline (§16)** now includes a **staging D1 database** step between local
  verification and production apply — migrations are proven against a real D1 instance
  before touching production, not just tested locally.

**v0.2 (2026-08-26)** — Revised from v0.1 to lock several previously-open decisions to
concrete, currently-maintained libraries, per the v0.1 policy that "any change should be
recorded so the document remains synchronized with the implementation." No architectural
boundary changed; the layered structure, domain model, and non-goals from v0.1 stand as-is.

- **Authentication** locked to **better-auth** with its D1/Drizzle adapter, instead of an
  unspecified "portable strategy." better-auth is actively maintained, has first-class
  Cloudflare Workers + D1 + Drizzle support, ships secure session/cookie handling and CSRF
  protection out of the box, and avoids hand-rolled crypto — consistent with the v0.1
  principle "use established technologies; do not reinvent authentication." Cloudflare
  Access remains available as an optional additional layer for self-hosted/internal
  deployments (§10).
- **Rich text editor** locked to **Tiptap** (ProseMirror-based, headless, React-friendly) for
  the `rich_text` field type (§6.1).
- **API contract generation** locked to **`@hono/zod-openapi`** — OpenAPI is generated
  directly from the same Zod schemas used for runtime validation, so the contract can never
  drift from the implementation (§8).
- **Admin data/routing layer** specified as **TanStack Query** (server-state caching,
  mutations, optimistic updates) and **React Router** — the original spec named "React +
  Vite" but left data-fetching and routing unspecified, which are real architectural
  decisions for an admin SPA (§3).
- **Rate limiting** specified as the native **Cloudflare Workers Rate Limiting binding**
  for auth and public form endpoints, rather than a hand-rolled KV counter (§9).
- **Testing** specified to use **`@cloudflare/vitest-pool-workers`** for repository/API-layer
  tests, so tests run inside the real `workerd` runtime against real D1/R2 bindings instead
  of mocks — directly serving the v0.1 principle that revision/recovery and security
  boundaries must be provable, not assumed (§17).
- **Migrations pipeline** made explicit: `drizzle-kit generate` → review SQL → `wrangler d1
  migrations apply` (local, then remote), both scripted in `packages/database` (§16).
- Stack Decision table (§25) updated to reflect the above as LOCKED.

Everything else below carries forward from v0.1 unchanged.

---

## 1. Executive Decision

Kenresoft CMS is a reusable content-management platform whose first production
implementation will power the Pathvera Group website. It is not a Pathvera-specific
dashboard. The core platform must be designed so additional clients can run the same CMS by
deploying their own instance of it — the same open-source codebase, not a rewrite and not a
new tenant inside Pathvera's deployment (§11).

The platform is Cloudflare-native and database-backed rather than Git-based. Content lives in
Cloudflare D1, media lives in Cloudflare R2, the API runs on Cloudflare Workers, and the
admin application communicates with the API rather than directly accessing the database.

### 1.1 Is this realistic?

Yes. The architecture is realistic for corporate websites, blogs, service directories,
portfolios, documentation sites, landing pages, team directories, FAQs, case studies, events
and similar content-driven applications. It is not intended initially to replace enterprise
CMS products such as Adobe Experience Manager, Sitecore, or a full WordPress ecosystem.

Cloudflare's D1 limits make this architecture practical for the intended workload class:
Workers Paid supports up to 50,000 D1 databases per account by default, each D1 database can
hold up to 10 GB, and Cloudflare explicitly describes D1 as suitable for horizontal
scale-out using one dedicated database per site — which is the default shape here (§11), not
an optimization applied later. R2 provides effectively unlimited bucket storage and supports
objects up to 5 TiB. Workers Paid provides no request-count limit and supports up to 5
minutes of CPU time per invocation. These limits are adequate for the target workload,
provided each deployment uses proper indexing, pagination and caching.

### 1.2 Can it handle forms?

Yes. Forms are a first-class use case. The CMS supports structured content forms generated
from field definitions, plus public website forms (contact, inquiry, newsletter/signup,
application/enquiry) through a separate form-submission model and API. Public submissions
must be isolated from administrative content and protected by validation, rate limiting,
spam protection and appropriate security controls.

### 1.3 Can it serve multiple clients?

Yes — as independent deployments, not as one shared installation. Each client gets their own
deployment of the same open-source codebase: its own Cloudflare account (or account-scoped
environment), its own D1 database, its own R2 bucket, its own Worker. There is no
`project_id`-scoped shared database and no cross-tenant boundary to defend inside a
deployment, because there is no second tenant inside it (§11). V1 launches with one
production deployment (Pathvera); additional clients get their own deployment from the same
codebase, not a new tenant inside Pathvera's.

---

## 2. Product Vision

Kenresoft CMS should become a lightweight, developer-friendly, Cloudflare-native CMS for
modern websites. Its differentiator is not maximum feature count. Its differentiator is
clean architecture, excellent Astro integration, simple deployment, strong content
modeling, predictable migrations, client-friendly administration and low infrastructure
friction.

### 2.1 Core principles

- Build small in scope, but never disposable in architecture.
- Content is stored in a database, not in Git.
- The CMS manages content; Astro manages presentation.
- The public API is a first-class product surface.
- Admin UI never accesses D1 directly.
- Every schema change is versioned through migrations.
- Backups and recovery are part of the platform, not afterthoughts.
- Security boundaries must exist before any deployment goes to production.
- Use established technologies; do not reinvent authentication, cryptography or database
  engines.
- Keep the core extensible without prematurely building an enterprise feature set.

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Language | TypeScript | Application and shared type safety |
| Backend runtime | Cloudflare Workers | API and server-side runtime |
| Backend framework | Hono | HTTP routing, middleware and API composition |
| Database | Cloudflare D1 | Relational SQL content database |
| Database tooling | Drizzle ORM + Drizzle Kit | Typed schema, queries and migrations |
| Media storage | Cloudflare R2 | Images, documents and other objects |
| Admin frontend | React + Vite | CMS administration application (SPA) |
| Admin routing | React Router | Client-side routing for the admin SPA |
| Admin server-state | TanStack Query | Caching, mutations, optimistic updates against the API |
| UI | Tailwind CSS + shadcn/ui | Consistent accessible admin UI |
| Rich text editor | Tiptap | `rich_text` field authoring (ProseMirror-based, headless) |
| Validation | Zod | Runtime request/content validation |
| API | REST + OpenAPI via `@hono/zod-openapi` | Public/admin API contract generated from Zod, not hand-authored |
| Authentication | better-auth (D1/Drizzle adapter) | Session-based admin auth, extensible to OAuth |
| Rate limiting | Cloudflare Workers Rate Limiting binding | Throttling for auth and public form endpoints |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` | Unit and integration tests inside real `workerd` runtime |
| E2E | Playwright | Browser workflow testing |
| Package management | pnpm | Monorepo dependency management |
| Repository | pnpm workspaces monorepo | Shared packages and applications |
| CI | GitHub Actions | Test/build/check automation |
| Frontend consumer | Astro | Website presentation layer |

### 3.1 Cloudflare-native architecture

Cloudflare Workers, D1 and R2 form the infrastructure foundation. Astro has an official
Cloudflare adapter and current Astro documentation supports deployment to Cloudflare
Workers, including server rendering, sessions and Cloudflare bindings. Astro 6 development
can use Cloudflare's workerd runtime, which improves local/production runtime parity.

---

## 4. High-Level Architecture

```
                        KENRESOFT CMS
                             |
              +--------------+--------------+
              |                             |
       Admin Application               Content API
              |                             |
              +--------------+--------------+
                             |
                     Cloudflare Workers
                             |
              +--------------+--------------+
              |                             |
              v                             v
       Cloudflare D1                 Cloudflare R2
     Structured data                  Media/files
              |
              v
   Migrations / Revisions /
   Content Types / Entries
```

Astro websites consume the Content API:

```
Astro -> CMS API -> D1/R2
```

### 4.1 Boundary rules

- Admin UI communicates with the API; it does not contain database credentials.
- Public websites consume the public API or an SDK; they do not connect directly to D1.
- D1 stores structured metadata/content; R2 stores binary media.
- The API is responsible for validation, authorization, business rules and database access.
- Presentation remains outside the CMS core.
- CMS core must not contain Pathvera-specific business logic.

---

## 5. Repository Structure

```
kenresoft-cms/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── routes/
│   │       ├── middleware/
│   │       ├── controllers/
│   │       ├── services/
│   │       ├── repositories/
│   │       ├── validators/
│   │       └── lib/
│   └── admin/
│       └── src/
│           ├── components/
│           ├── features/
│           ├── layouts/
│           ├── pages/
│           ├── routes/
│           └── lib/
├── packages/
│   ├── database/
│   │   ├── schema/
│   │   ├── migrations/
│   │   ├── seed/
│   │   └── src/
│   ├── contracts/
│   │   ├── schemas/
│   │   └── api/
│   ├── types/
│   └── config/
├── integrations/
│   └── astro/        — @kenresoft-cms/astro, the first-class Astro client (§15)
├── docs/
├── examples/
│   └── astro-site/   — reference Astro consumer built on @kenresoft-cms/astro
├── tests/
├── .github/
│   └── workflows/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

---

## 6. Core Domain Model

| Entity | Purpose |
|---|---|
| Settings | Singleton per-deployment site configuration (name, contact email, social links, CORS origin, feature flags) |
| User | Administrative identity |
| Role | Authorization role; initially simple, extensible later |
| ContentType | Defines a reusable type such as Blog Post or Service |
| FieldDefinition | Defines fields belonging to a content type |
| Entry | Actual content instance |
| EntryRevision | Historical version of an entry |
| Media | Metadata for R2 objects |
| Form | Definition of a public or administrative form |
| FormSubmission | Captured form submission; separate from CMS content |
| AuditLog | Security/administrative activity history |
| APIKey | Future programmatic access mechanism |

### 6.1 Initial content field types

- text
- textarea
- rich_text (Tiptap-authored)
- number
- boolean
- date
- datetime
- slug
- email
- url
- select
- multi_select
- image/media
- reference

Future field types may include repeatable groups, relations, localized fields, JSON/object
fields and custom components. These should be added only after the core content model is
stable.

---

## 7. Forms Architecture

Forms are explicitly within scope. There are two distinct form categories.

| Form category | Purpose | Examples |
|---|---|---|
| CMS/editor forms | Create and edit structured content | Blog Post, Service, Team Member |
| Public website forms | Collect user submissions | Contact, enquiry, application, newsletter |

Public forms should not simply write arbitrary JSON into content entries. A Form definition
describes its fields and validation rules, while FormSubmission stores the submitted values,
timestamps, status and relevant metadata. Public forms must include rate limiting, input
validation, spam protection, submission size limits and a configurable retention strategy.

---

## 8. API Design

The API is versioned from the beginning.

```
https://cms.example.com/api/v1/
```

**Public:**
```
GET /api/v1/public/:contentType
GET /api/v1/public/:contentType/:slug
```

**Admin:**
```
GET    /api/v1/admin/content-types
POST   /api/v1/admin/content-types
GET    /api/v1/admin/entries
POST   /api/v1/admin/entries
PATCH  /api/v1/admin/entries/:id
DELETE /api/v1/admin/entries/:id
```

**Media:**
```
POST   /api/v1/admin/media
DELETE /api/v1/admin/media/:id
```

**Forms:**
```
GET  /api/v1/admin/forms
POST /api/v1/public/forms/:slug/submissions
```

Exact routes are provisional and may be revised during implementation. Route handlers are
defined with `@hono/zod-openapi`, so the same Zod schema validates the request at runtime
and generates the OpenAPI document — the contract cannot drift from the implementation.
`packages/contracts` holds the shared Zod schemas consumed by the API, the admin app, and
(later) the SDK.

---

## 9. Security Architecture

- Never expose D1 credentials or bindings to the browser.
- Validate all external input with Zod.
- Use parameterized database queries.
- Apply authorization at the API/service layer, not only in the UI.
- Separate public read operations from administrative write operations.
- Protect admin applications with a robust authentication mechanism (better-auth, §10).
- Use secure, HttpOnly, SameSite cookies for browser sessions (handled by better-auth).
- Implement CSRF protection for cookie-authenticated state-changing requests (handled by
  better-auth).
- Apply the Cloudflare Workers Rate Limiting binding to authentication, public form
  submissions and other sensitive endpoints.
- Restrict CORS to an explicit allow-list of known origins (admin app, Astro sites); never
  default to `*`. Configure per-environment via a `CORS_ORIGINS` binding/var.
- Apply a security headers middleware to all responses: `Content-Security-Policy`,
  `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`,
  `Referrer-Policy`, `Permissions-Policy`.
- Sanitize all public form submission input before persisting it, to prevent stored XSS —
  do not trust that Zod validation alone makes content safe to render later.
- Validate upload MIME types, file sizes and object keys before writing to R2.
- Never trust filename extensions or browser-provided MIME types alone.
- Record security-sensitive administrative actions in an audit log.
- Use least-privilege API keys/service credentials.
- Keep secrets in Cloudflare secrets/environment bindings, never in Git.
- Perform dependency and security audits in CI.
- Use Cloudflare Access where appropriate for private/internal administration; if Access
  JWTs are used, validate the JWT signature at the origin.

**Important:** Cloudflare Access is an additional identity-aware security layer, not a
reason to remove application-level authorization. A public/open-source CMS must retain its
own authorization model so it can operate in environments that do not use Cloudflare Access.

---

## 10. Authentication and Authorization

Authentication uses **better-auth** with its D1/Drizzle adapter — an established,
actively-maintained library rather than custom cryptography, satisfying the v0.1 principle
of not reinventing authentication. better-auth provides session management, secure
HttpOnly/SameSite cookies, CSRF protection, and a path to OAuth/social providers later
without a rewrite. It is portable: it does not depend on Cloudflare Access, so the CMS
remains deployable in environments that don't use Cloudflare's identity layer.

Cloudflare Access can additionally protect the admin origin for self-hosted/internal
deployments — an extra identity-aware layer in front of the application, not a replacement
for it.

Authorization is represented separately from authentication, as a fixed role stored on the
`user` row (`role: 'owner' | 'admin' | 'editor' | 'author' | 'viewer'`, see the v0.9 and v0.10
changelog entries above for how this set grew from an initial two-role Owner/Editor split, then
gained a real Owner role distinct from Admin). Roles form a strict hierarchy — each satisfies
every check the ones below it satisfy (`ROLE_RANK`/`roleAtLeast()` in
`packages/contracts/schemas/enums.ts`), not five independent, unrelated sets of permissions:

- **Owner** — everything Admin can do, plus is immune to every other role's user-management
  actions: no Admin can demote, delete, or disable the Owner, and role/ownership changes to or
  from Owner only ever happen through the dedicated ownership-transfer flow, never the general
  role-change route. Represents ownership of *this specific installation* — not a Kenresoft or
  any other external account (§11 restates why no such account exists). The first person to
  sign up on a deployment becomes its Owner.
- **Admin** — everything: structure (content types, forms, their fields), users and roles
  (except touching the Owner), settings, cache purge, plus everything Editor and Author can do.
- **Editor** — any entry (not just their own), form submission triage, media, and
  content-type/form field management. No structure creation/rename, no user or role
  management, no settings.
- **Author** — can create entries freely, but may only edit or delete entries they themselves
  created; read access is unrestricted. No media, forms, or structure management.
- **Viewer** — read-only across every admin route; no writes anywhere.

Two invariants hold regardless of who's acting: the deployment can never end up with zero
Owners *and* zero Admins at once (demoting, deleting, or disabling the last one is rejected),
and the Owner can never be touched by anyone but themself. Disabling an Admin — as opposed to a
lower role — additionally requires the acting Owner/Admin to re-verify their password in the
last few minutes (`POST /api/v1/admin/security/elevate`), so a merely-open admin session isn't
by itself enough to disable a peer.

The data model remains extensible toward more granular, per-resource permissions if a fixed
role set stops being enough, and toward multiple simultaneous Owners if that's ever needed —
the guard logic already counts Owners generically rather than assuming exactly one; only the
transfer endpoint's swap-not-grant semantics currently assume a single Owner.

### 10.1 Account recovery

Three independent, self-service-first layers, from least to most privileged access required
(see the v0.11 changelog entry above for full implementation detail):

1. **Password reset** — `POST /api/v1/public/password-reset/{request,confirm}`, unauthenticated,
   email-based. `request` always responds with the same generic message whether or not the
   email matches an account. The reset token is a random 48-character string; only its SHA-256
   hash is ever stored (in better-auth's own `verification` table, under a bespoke identifier
   scheme — not better-auth's own reset routes, which store the token in plaintext), expires in
   1 hour, and is single-use. Requires the deployment to have an email provider configured
   (`EMAIL_PROVIDER` — see docs/DEPLOYMENT.md for setup); if unset, requests still succeed but no email is
   actually sent (`apps/api/src/lib/email/noop.ts` logs instead).
2. **Recovery codes** — `POST /api/v1/public/recovery/redeem`, unauthenticated, no email
   required. Ten single-use hashed codes the Owner generates for themselves ahead of time
   (Settings → Users & Permissions, elevation-gated) and stores somewhere safe — shown once,
   never re-displayed, never stored in plaintext. Exists specifically for "forgot my password
   *and* lost my email" — the one gap password reset alone can't cover.
3. **Owner recovery** — for the Owner having neither their password nor a recovery code. Two
   independent mechanisms, both operating directly on the database rather than through the
   normal auth routes: `apps/api/scripts/recover-owner.mjs` (an operator-run CLI against a real
   `wrangler` session — preferred whenever this kind of deployment access exists, since it needs
   no standing secret at all), and `POST /api/v1/system/recover-owner` (a break-glass HTTP
   endpoint, gated by an `OWNER_RECOVERY_SECRET` Worker secret that's absent by default — the
   route 404s, indistinguishable from not existing, until an operator deliberately enables it).

Every one of these shares a single conservative rate limiter (`RECOVERY_RATE_LIMITER`, 3/60s per
IP) — the tightest in this API, since success at any of them changes a password — and every
successful credential change is recorded in `audit_log` regardless of which path performed it.

---

## 11. Deployment Model: Single Site Per Instance

Kenresoft CMS is not operated as a shared, multi-tenant installation. Every deployment backs
exactly one website. A second client does not become a second tenant inside an existing
deployment — they get their own deployment of the same open-source codebase.

```
kenresoft-cms (codebase)
      |
      +--> Pathvera's deployment   → its own Cloudflare account, D1, R2, Worker
      +--> Client B's deployment   → its own Cloudflare account, D1, R2, Worker
      +--> Client C's deployment   → its own Cloudflare account, D1, R2, Worker
```

Standing up a new instance:

1. Fork or clone the `kenresoft-cms` repository.
2. Provision that client's own Cloudflare resources: a D1 database, an R2 bucket, and (if
   used) a KV namespace.
3. Configure that deployment's environment/secrets — `CORS_ORIGINS`, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` — and its site-level values in the `Settings` table (§6).
4. Run migrations against that client's D1 database (§16) and `wrangler deploy`.

This is deliberately the same shape as other self-hosted open-source CMS products (Strapi,
Directus, Payload, SonicJS itself) rather than a hosted SaaS model: the product is the
codebase, not a running multi-tenant service Kenresoft operates on clients' behalf. This
choice was made specifically because finished sites are sometimes handed off to a
non-technical client to run independently — a shared installation cannot be handed off
without exposing other clients' data, and a fully isolated deployment can.

Reusability is unaffected by dropping multi-tenancy: `packages/contracts`,
`packages/database`, `apps/api` and `apps/admin` remain fully generic and must never contain
Pathvera-specific business logic (§4.1) — the same codebase is what gets redeployed per
client, not a shared runtime.

This isolation is why Kenresoft holds no master or backdoor account into any deployment, and
why the codebase must never grow one: each installation's D1 database, secrets
(`BETTER_AUTH_SECRET` and any future recovery secret), and Owner account (§10) are entirely
local to that one deployment. There is no shared identity layer, no cross-deployment lookup,
and no code path that references a "Kenresoft account" at all — Client A's Owner has exactly
zero access to Client B's installation, the same as any two unrelated Strapi/Directus
installations would.

---

## 12. Scalability Assessment

The platform is scalable for the intended CMS workload, but scalability here is not a claim
of unlimited enterprise throughput. D1 has a 10 GB per-database limit on Workers Paid and
each individual D1 database is single-threaded. The architecture must use efficient
queries, indexes, pagination and, at higher scale, read replication where appropriate.
Because every deployment already has its own dedicated database (§11), there is no
cross-tenant sharding concern to design for — scale is managed per site, not across a shared
installation.

For the expected corporate-site workload — pages, services, blogs, FAQs, team records, forms
and media metadata — these constraints are not a practical blocker. R2 is the appropriate
place for large files because its object storage is designed for very large-scale media
storage.

A caching layer sits in front of the public content API (§8) to keep D1's single-threaded
limit from becoming a bottleneck under read load: the Cloudflare Cache API for per-colo edge
caching of anonymous GET responses, with Cloudflare Workers KV as a read-through cache where
cross-colo consistency or a longer TTL than the Cache API provides is needed. Cache entries
are invalidated on publish/unpublish (§13) rather than left to expire blindly, so editors see
their changes reflected promptly instead of waiting out a TTL.

---

## 13. Content Lifecycle

```
Draft
  |
  +--> Edit
  |
  +--> Save revision
  |
  +--> Preview
  |
  +--> Schedule (optional; publishAt set, still Draft)
  |
  +--> Publish (immediate, or automatically once publishAt elapses)
  |
  +--> Published
  |
  +--> Unpublish / Archive
  |
  +--> Restore previous revision
```

Revision history is part of the safety model. A client should be able to recover from an
accidental edit without contacting a developer.

Scheduled publishing is optional: an entry may carry a nullable `publishAt` timestamp while
still in Draft or Preview. A Cloudflare Cron Trigger periodically scans for entries whose
`publishAt` has passed and transitions them to Published, so editors can queue content ahead
of time (an announcement, a dated blog post) without keeping a session open until go-live.

---

## 14. Media Architecture

- Binary objects live in R2.
- D1 stores media metadata and the R2 object key.
- Use stable object keys generated by the application.
- Validate content type and size before upload.
- Generate/record dimensions for supported image types.
- Store accessibility metadata such as alt text.
- Support deletion and orphan cleanup.
- Use direct or multipart R2 uploads when file size/performance requires it.
- Do not store large media blobs in D1.
- **File serving**: `GET /api/v1/admin/media/:id/file` (admin-gated) and `GET
  /api/v1/public/media/:id/file` (public, unauthenticated, edge-cached for a year since media
  is immutable — create/delete only, no edit endpoint). Media has no draft/published concept,
  so the public route has no status to hide: once uploaded, any id is servable, the same trust
  model as any CDN-backed asset URL. Alt text/dimensions are also public, via `GET
  /api/v1/public/media/:id` → `{ altText, contentType, width, height }` — everything an `<img>`
  needs beyond the file bytes above (docs/ASTRO.md's `media.get()`).

---

## 15. Astro Integration

Astro is a first-class, officially supported frontend target — not a requirement. The CMS is
frontend-agnostic; the public API (§8) is the only integration boundary, and any framework
(Next.js, Vue, Flutter, ...) can call it directly with a plain `fetch()`. Astro gets a typed
client, `@kenresoft-cms/astro` (`integrations/astro/`), so Astro developers don't have to hand-roll
`fetch()` calls or know the API's internal shape — but the CMS core never imports anything
Astro-specific, and nothing about the client is actually Astro-specific at the code level
either (it's a plain fetch wrapper any JS/TS project could use — see
`integrations/astro/README.md`).

```
Astro site
   |
   +--> @kenresoft-cms/astro
              |
              v
        Kenresoft CMS public API   (GET /api/v1/public/...)
              |
              +--> D1
              +--> R2   (not yet — see docs/ASTRO.md's Known Limitations)
```

**Status (2026-08-27): Phase 1 (local integration) is done, including public media serving**
— see `docs/ASTRO.md` for the full guide, and `examples/astro-site/` for a working reference
consumer verified against a real local deployment (build + dev server, real published entries,
draft/publish enforcement confirmed end-to-end, featured images served via the public media
route). Phase 2 (production deployment of an Astro site alongside a Kenresoft CMS deployment)
is not started; §20's Phase 8 tracks it.

Astro's official Cloudflare adapter currently supports deployment to Cloudflare Workers and
provides access to Cloudflare platform capabilities. Astro 6 uses Cloudflare's workerd
runtime for development, useful for production-parity testing.

---

## 16. Migrations, Backup and Recovery

- Every schema change must be represented by a new migration.
- Applied migrations must never be edited retroactively.
- Migration pipeline: `drizzle-kit generate` (author schema change in
  `packages/database/schema`, generate SQL) → review generated SQL → `wrangler d1
  migrations apply kenresoft-cms-db --local` (verify locally) → apply to a staging D1
  database and verify against a staging Worker deployment → `--remote` (production, via
  documented deployment process). Never apply a migration to production without a staging
  verification pass first.
- Migration tests run against realistic seeded data.
- Destructive migrations must have a recovery/rollback strategy.
- D1 Time Travel/backups are part of the operational recovery plan.
- Export/restore procedures are documented and tested.
- Media backup strategy accounts for R2 objects separately from D1 metadata.

---

## 17. Testing Strategy

| Layer | Test focus |
|---|---|
| Unit | Validation, services, utility functions, content rules |
| Repository/integration | D1 queries, transactions, migrations — run via `@cloudflare/vitest-pool-workers` against real bindings, not mocks |
| API | Authentication, authorization, CRUD, validation, error responses |
| E2E | Login, create/edit/publish, media upload, form submission |
| Migration | Upgrade seeded databases across migration versions |
| Security | Authorization boundaries, injection attempts, upload validation, rate limiting |
| Frontend | Dynamic form rendering and key admin workflows |

---

## 18. Form System — Initial Requirements

- Dynamic form definitions.
- Field types and validation rules.
- Required/optional fields.
- Text, textarea, email, URL, number, select, checkbox and date fields initially.
- Submission storage with timestamps and status.
- Admin view for submissions.
- Spam/rate-limit protection.
- Configurable retention/deletion.
- Optional notification/webhook integration later.
- No arbitrary executable content from form submissions.

---

## 19. Explicit Non-Goals for V1

- Visual website/page builder.
- E-commerce engine.
- CRM.
- Newsletter delivery platform.
- Enterprise workflow engine.
- Plugin marketplace.
- Full localization platform.
- Real-time collaborative editing.
- Operating a shared multi-tenant hosting service for multiple clients from one running
  installation (§11) — each client gets their own deployment instead.
- Custom authentication/cryptography implementation.
- Replacement for every feature of WordPress, Drupal, Directus or enterprise CMS products.

---

## 20. Implementation Roadmap

| Phase | Deliverable |
|---|---|
| 0 | Architecture, repository and domain model |
| 1 | Worker + Hono + D1 + Drizzle + migrations |
| 2 | Content types + fields + entries |
| 3 | Admin authentication (better-auth) + dashboard + dynamic editor |
| 4 | Draft/publish + scheduled publishing + revisions + restore |
| 5 | R2 media library |
| 6 | Public/admin REST API + OpenAPI (`@hono/zod-openapi`) + public API caching (Cache API/KV) |
| 7 | Forms + submissions + spam/rate limiting |
| 8 | Astro integration (local: done, §15) and Pathvera production integration (not started) |
| 9 | Testing, security hardening, backups and migration testing |
| 10 | Open-source documentation, examples and release process |

### 20.1 First vertical slice

The first complete vertical slice should be a Blog Post because it exercises content
modeling, dynamic forms, rich text, slugs, media, draft/publish state, API delivery and
Astro rendering.

```
Create Blog Post
      ↓
Save as Draft
      ↓
Edit / validate
      ↓
Upload cover image
      ↓
Publish
      ↓
API returns published post
      ↓
Astro renders the post
```

---

## 21. AI-Assisted Development Strategy

AI coding agents are suitable for this project and can materially accelerate
implementation. The architecture, security model, database boundaries, migration policy and
API contracts remain human-controlled.

- This document is the architectural source of truth for any agent working on the project.
- Require small, reviewable commits.
- Require tests for new business logic.
- Never allow an agent to silently change database schema without a migration.
- Review authentication and authorization code manually.
- Use CI to enforce type-checking, linting, tests and builds.
- Have agents generate documentation alongside implementation.

---

## 22. Open-Source Readiness

- MIT license (adopted at repository init — see `LICENSE`).
- README with architecture and quick start.
- CONTRIBUTING.md.
- SECURITY.md with vulnerability-reporting process.
- CODE_OF_CONDUCT.md.
- CHANGELOG.md.
- Versioned releases.
- Example Astro project.
- API documentation.
- Database migration documentation.
- Deployment documentation for Cloudflare.

(These are Phase 10 deliverables; not all exist yet at Phase 0.)

---

## 23. Major Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Scope explosion | Strict V1 non-goals and vertical-slice delivery |
| D1 single-threaded database | Indexes, efficient queries, caching, pagination, future database sharding |
| 10 GB per D1 database | Each deployment already has its own dedicated database (§11) and R2 for media; monitor storage |
| Authentication mistakes | better-auth (established library) + security review, not custom crypto |
| Data loss | D1 recovery/export procedures, revisions and tested migrations |
| Open-source maintenance burden | Modular architecture, tests, documentation and semantic versioning |
| AI-generated architectural drift | Source-of-truth specification and human review |
| Client misuse | Simple admin UX, validation, confirmations, revisions and role controls |
| Vendor lock-in | Repository abstraction, standard SQL concepts, REST/OpenAPI and portable content model |

---

## 24. Final Recommendation

Proceed with Kenresoft CMS. The project is technically realistic and strategically
worthwhile if its scope is controlled and the architecture remains modular. The first
production target is Pathvera, but Pathvera must not be embedded into the CMS core.

The objective is not to immediately compete feature-for-feature with every CMS on the
market. The objective is to create a reliable, Cloudflare-native, developer-friendly CMS
that is excellent at modern content-driven websites and can progressively expand into a
broader open-source platform.

The architecture should be ambitious while the implementation remains incremental.

---

## 25. Current Stack Decision

| Decision | Status |
|---|---|
| TypeScript | LOCKED |
| Cloudflare Workers | LOCKED |
| Hono | LOCKED |
| D1 | LOCKED |
| Drizzle ORM | LOCKED |
| R2 | LOCKED for media |
| React + Vite admin | LOCKED |
| React Router | LOCKED |
| TanStack Query | LOCKED |
| Tailwind + shadcn/ui | LOCKED |
| Tiptap (rich text) | LOCKED |
| Zod | LOCKED |
| REST + OpenAPI via `@hono/zod-openapi` | LOCKED |
| better-auth | LOCKED |
| Cloudflare Rate Limiting binding | LOCKED |
| Cloudflare Cache API + Workers KV (public API caching) | LOCKED |
| Cloudflare Cron Triggers (scheduled publishing) | LOCKED |
| `@cloudflare/vitest-pool-workers` | LOCKED |
| pnpm monorepo | LOCKED |
| Astro integration | FIRST-CLASS TARGET |
| Pathvera | FIRST PRODUCTION PROJECT |
| Open source | LONG-TERM INTENT |

---

## 26. Current Technical References

- Cloudflare D1 Limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare R2 Limits: https://developers.cloudflare.com/r2/platform/limits/
- Cloudflare R2 Uploads: https://developers.cloudflare.com/r2/objects/upload-objects/
- Cloudflare D1 API via Worker: https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/
- Astro Cloudflare Adapter: https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- Cloudflare Access Applications: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/
- Cloudflare Access JWT Validation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Cloudflare Workers Rate Limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Cloudflare Cache API: https://developers.cloudflare.com/workers/runtime-apis/cache/
- Cloudflare Workers KV: https://developers.cloudflare.com/kv/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Vitest Cloudflare Workers Integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- better-auth: https://www.better-auth.com/
- Hono Zod OpenAPI: https://hono.dev/examples/zod-openapi

---

## 27. Specification Status

This is Version 0.6. It is an implementation-oriented architectural baseline, not an
immutable contract. Database schema details, exact API routes and deployment topology may
still be refined as later phases land. Any change should be recorded in the Changelog above
so this document stays synchronized with the implementation.
