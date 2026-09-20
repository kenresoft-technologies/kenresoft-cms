# @kenresoft-cms/astro: Astro Integration

A typed client for consuming a Kenresoft CMS deployment's **public API** from Astro (or any other
JS/TS frontend). This is not a CMS component, not a Cloudflare Worker, and not independently
deployable. It's a library your own site's codebase depends on, the same way it might depend on
any other API client.

Do not confuse this with the **Admin Worker** (`apps/admin`). That's the CMS's own management
dashboard. This integration is for the separate site/frontend that *reads* content from the CMS,
typically a marketing site or blog built on Astro. See [`examples/astro-site`](../../examples/astro-site)
for a complete, working reference site built on this package, and
[`docs/ASTRO.md`](../../docs/ASTRO.md) for the fuller guide (static vs SSR, current limitations).

## What it does

Wraps the CMS's public REST API (`GET /api/v1/public/*` on the [API Worker](../../apps/api/README.md))
in a small, typed client: listing/fetching entries, resolving media file URLs, and submitting
public forms. It's plain `fetch()` underneath. Nothing in `src/index.ts` is actually
Astro-specific, despite the package name. It's named and documented as Astro's path in because
Astro is this project's first-class, officially supported frontend integration
(`docs/ARCHITECTURE.md` §15); any other framework can call the same public REST API directly
without this package at all.

## Installation

**In your own, separately-hosted Astro project**, against your own Kenresoft CMS deployment:
this is the normal case for anyone who isn't working inside this monorepo:

```bash
npm install @kenresoft-cms/astro
# or: pnpm add @kenresoft-cms/astro / yarn add @kenresoft-cms/astro
```

**Updating to a new version later:** this package is still 0.x, so a caret range like
`^0.3.0` in your `package.json` only resolves within `0.3.x`. A plain `npm update`/`pnpm update`
(no version specified) will silently stay on your current minor version and never pick up a new
one like `0.4.0`. To actually get the latest release, install it explicitly:

```bash
npm install @kenresoft-cms/astro@latest
# or: pnpm add @kenresoft-cms/astro@latest / yarn add @kenresoft-cms/astro@latest
```

Published on npm under the `@kenresoft-cms` scope (same organization as
[`@kenresoft-cms/contracts`](../../packages/contracts) and
[`@kenresoft-cms/create`](../../packages/create)). It depends on `@kenresoft-cms/contracts` for
its own TypeScript types. Installed automatically, nothing extra to add. See "Connecting your
own Astro project" below for a full walkthrough, or scaffold a starter with zero manual wiring
via `npm create @kenresoft-cms@latest my-site -- --astro` (see the root
[README](../../README.md)/[`packages/create`](../create)).

Inside this monorepo (e.g. from `examples/astro-site`), it's a normal workspace dependency
instead, `pnpm install` at the repo root symlinks it to the local, unpublished-yet-in-progress
source automatically:

```json
{ "dependencies": { "@kenresoft-cms/astro": "workspace:*" } }
```

## Connecting your own Astro project

A minimal, from-scratch example. This is everything needed, no monorepo, no workspace linking:

```bash
npm create astro@latest my-site   # or add to an existing Astro project
cd my-site
npm install @kenresoft-cms/astro
```

```ts
// src/lib/cms.ts
import { createKenresoftClient } from '@kenresoft-cms/astro';

export const cms = createKenresoftClient({
  url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL, // e.g. https://api.your-deployment.workers.dev
});
```

```
// .env — Astro's PUBLIC_ prefix ships this to the browser too, which is fine: it's just the
// CMS's public API base URL, never a secret (the public API needs no authentication at all).
PUBLIC_KENRESOFT_CMS_URL=http://localhost:8787
```

```astro
---
// src/pages/blog/[slug].astro
import { cms } from '../../lib/cms';

const post = await cms.entries.get({ contentType: 'blog-post', slug: Astro.params.slug! });
if (!post) return new Response(null, { status: 404 });
---
<h1>{post.data.title}</h1>
```

That's the whole integration surface: point `createKenresoftClient({ url })` at your deployed API
Worker (or `wrangler dev`'s `http://localhost:8787` while developing locally against your own
CMS), then call `entries`/`media`/`forms`/`pages`/`settings` as documented below. Your Astro
project needs `output: 'server'` (plus a deploy adapter, e.g. `@astrojs/cloudflare`) to see
published edits without a rebuild. See `docs/ASTRO.md`'s "Static vs SSR" section for why
`examples/astro-site` made that same choice. `output: 'static'` still works with
`getStaticPaths()`, at the cost of needing a rebuild to pick up new/edited content.

## Configuration

One required value: the URL of your deployed API Worker (or `http://localhost:8787` for local
development against the API running via `wrangler dev`). `examples/astro-site` reads this from
`PUBLIC_KENRESOFT_CMS_URL` (Astro's `PUBLIC_` prefix so it's available client-side), but this
package itself takes it as a plain constructor argument. See "Usage" below.

## Usage

```ts
import { createKenresoftClient, KenresoftApiError } from '@kenresoft-cms/astro';

const cms = createKenresoftClient({ url: 'http://localhost:8787' });
```

## API interaction / content fetching

```ts
const posts = await cms.entries.list({ contentType: 'blog-post' });
const post = await cms.entries.get({ contentType: 'blog-post', slug: 'hello-world' });
```

Both hit the CMS's public, unauthenticated content API, filtered to `status: 'published'` at the
server. A draft entry matching the requested slug 404s exactly like a slug that doesn't exist,
never distinguishable from the outside. There is deliberately no `contentTypes.list()`. No
public content-type-metadata endpoint exists to back one (an open product decision, not an
oversight; see `docs/ASTRO.md`).

### Live Preview (draft rendering)

Kenresoft CMS's Entry/Page Editor "Live Preview" button opens your page with
`?preview_token=...` appended. The recommended way to wire this up needs **no per-page code at
all**. Bind one client per request, in middleware, and every page that reads from it gets Live
Preview for free:

```ts
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';
import { createKenresoftClient, getPreviewToken } from '@kenresoft-cms/astro';

export const onRequest = defineMiddleware((context, next) => {
  context.locals.cms = createKenresoftClient({
    url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL,
    previewToken: getPreviewToken(context.url), // null on a normal request — a no-op default
  });
  return next();
});
```

```astro
---
// Any page — no ?preview_token= handling here at all. If this request carried one, the client
// above already knows about it, so this plain call transparently renders a draft (or any
// status) through this exact same template instead of 404ing.
const post = await Astro.locals.cms.entries.get({ contentType: 'blog-post', slug });
---
```

`getPreviewToken(input)` accepts a `URL` (`Astro.url`), an absolute URL string, or a `Request`
(`Astro.request`) and extracts `preview_token`, returning `null` when it's absent. Always safe
to pass straight into `createKenresoftClient({ previewToken: ... })`.

If you'd rather not add middleware, the same thing works per call. Pass `previewToken` directly
to `entries.get()`/`pages.resolve()`, which still falls back to the client's own default (if any)
when omitted:

```astro
---
const previewToken = getPreviewToken(Astro.url);
const post = await cms.entries.get({ contentType: 'blog-post', slug, previewToken });
---
```

Passing `previewToken: null` explicitly (either at client creation or on one call) always forces
normal published-only rendering, even if a client-level default is set. `entries.preview()`/
`pages.preview()` also still exist as explicit standalone calls for callers that already have a
token in hand and don't need any of the above.

> **⚠ If your site (or this one page) uses static output (`output: 'static'` + `getStaticPaths()`),
> Live Preview will 404 every draft no matter what the code above does.** A dynamic route only
> gets a real page for the params `getStaticPaths()` returned at build time. A draft's slug was
> never in that list, so Astro 404s the request itself before this page's code ever runs. Add
> `export const prerender = false;` to the top of this one page's frontmatter (requires an
> on-demand-capable adapter, e.g. `@astrojs/cloudflare`/`@astrojs/node`, the rest of your site can
> stay fully static) or switch the whole site to `output: 'server'`. See `docs/ASTRO.md`'s "Live
> Preview requires the page to render on demand" section for the full explanation and snippet.

## Media/content integration

```ts
// A media-type field on an entry stores a Media item's id — this builds the public file URL
// for it directly (no extra fetch; use it as an <img src>).
const imageUrl = cms.media.url({ id: post.data.featuredImage as string });

// Real metadata (alt text, dimensions) for that same file, when you need more than just the URL.
const meta = await cms.media.get({ id: post.data.featuredImage as string });
```

## Forms

```ts
try {
  await cms.forms.submit({ formSlug: 'contact', data: { name: 'Ada', message: 'Hi!' } });
} catch (err) {
  if (err instanceof KenresoftApiError && err.issues) {
    // err.issues: { path, message }[] — per-field validation errors from the CMS's own
    // per-form field definitions.
  }
}
```

Submissions are rate limited and validated server-side against the form's actual field
definitions. This client doesn't duplicate that validation, it just surfaces the server's
response.

## Authentication

`client.auth` is the generic frontend auth API for any Astro (or other) site that has accounts. It calls the CMS's own better-auth (`/api/v1/auth/*`) and password-reset (`/api/v1/public/password-reset/*`) routes: one identity system, no separate auth service, and nothing specific to Commerce. Accounts a visitor registers here have no CMS role, so signing up on your site can never grant admin access. (Commerce's `client.commerce.customerAuth` is a thin adapter over this same object.)

Login, register, and account screens are ordinary source files in **your** Astro project, styled however you like. The CMS never renders them. See `examples/astro-site/src/pages/account/` for a complete set.

### Recommended: same-origin proxy (works on every domain layout)

By default the API's session cookie belongs to the API's own origin. Your site's server never sees it, so no server-side "is this visitor signed in?" checks, and browsers that block third-party cookies drop it entirely. The fix that works everywhere, including two unrelated `*.workers.dev` hosts, is to make the cookie first-party: your site forwards `/cms/*` to the API, and the browser only ever talks to your site.

```ts
// src/pages/cms/[...path].ts
import type { APIRoute } from 'astro';
import { createCmsProxy } from '@kenresoft-cms/astro';

export const prerender = false;
const proxy = createCmsProxy({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL });
export const ALL: APIRoute = ({ request }) => proxy(request);
```

```ts
// browser code: talk to your own origin
const cms = createKenresoftClient({ url: '/cms' });
// server (SSR) code: talk to the API directly, forwarding the now first-party cookie
const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL, cookies: Astro.request.headers.get('cookie') });
```

- Only `/api/v1/auth/*`, `/api/v1/public/*` and `/api/plugins/*/public/*` are forwarded; the admin API is never reachable through the proxy.
- Your site's origin must still be in the API's `CORS_ORIGINS` (better-auth checks the `Origin` header on the forwarded requests).
- **Rate limits:** the API limits per client IP, and behind a proxy every request comes from the proxy. To keep visitors separate, run `wrangler secret put TRUSTED_PROXY_SECRET` on the API, and pass the same value as `trustedProxySecret` to `createCmsProxy` (read it from your platform's server-side env, never a `PUBLIC_` variable). The API only honors the forwarded IP when the secret matches; unset, nothing changes.

### Direct mode (no proxy)

Simpler, but browser-only sessions:

```ts
// src/lib/browser-client.ts
import { createKenresoftClient, KenresoftApiError } from '@kenresoft-cms/astro';

export const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL });
export { KenresoftApiError };
```

1. **Add your site's origin to the API's `CORS_ORIGINS`** (e.g. `https://www.example.com,http://localhost:4321`). Every auth call sends `credentials: 'include'`; the API only answers credentialed requests from listed origins. The same list is what allows `callbackUrl` / `redirectUrl` values, so the emailed links can point back at your own pages.
2. **Call the mutating methods from the browser** (a `<script>` tag or a client island), not from Astro frontmatter. The session cookie is set on the API's origin, so it has to land in the visitor's own cookie jar, and better-auth checks the `Origin` header on state-changing requests, which browsers send and server-side `fetch` does not.
3. For a server-rendered "is this visitor signed in?" check, pass the incoming request's cookie header: `createKenresoftClient({ url, cookies: Astro.request.headers.get('cookie') })`, then `await client.auth.getSession()` (see `examples/astro-site/src/lib/site-client.ts`). That works when your site and the API share a cookie domain (e.g. `www.example.com` and `api.example.com`, with the API's cookie scoped to the parent domain). On unrelated origins the browser never sends the API's cookie to your site, so no SDK can see it during SSR; check `auth.getSession()` in the browser instead.

### Build your own flows

```astro
<form id="login"> <!-- your markup --> </form>
<script>
  import { cms, KenresoftApiError } from '../lib/browser-client';

  document.getElementById('login')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const result = await cms.auth.signIn({ email: String(data.get('email')), password: String(data.get('password')) });
      if (result.twoFactorRequired) return showCodeInput(); // then cms.auth.twoFactor.verifyTotp({ code })
      window.location.href = '/account';
    } catch (err) {
      if (err instanceof KenresoftApiError && err.code === 'EMAIL_NOT_VERIFIED') return showResendLink();
      showError(err instanceof KenresoftApiError ? err.message : 'Something went wrong.');
    }
  });
</script>
```

| Method | Endpoint | Notes |
| --- | --- | --- |
| `signUp({ email, password, name, callbackUrl? })` | `POST /api/v1/auth/sign-up/email` | Emails a verification link; resolves `{ requiresEmailVerification: true }` with no session. An already-registered email resolves identically. |
| `signIn({ email, password, rememberMe? })` | `POST /api/v1/auth/sign-in/email` | Resolves `{ twoFactorRequired, user }`. Throws 401 `INVALID_EMAIL_OR_PASSWORD` / 403 `EMAIL_NOT_VERIFIED` (a fresh link is sent). |
| `signOut()` | `POST /api/v1/auth/sign-out` | Idempotent. |
| `getSession()` | `GET /api/v1/auth/get-session` | `{ user, session }`, or `null` when signed out (never throws for that). |
| `verifyEmail({ token })` | `GET /api/v1/auth/verify-email` | For a `callbackUrl` page that receives `?token=`. |
| `resendVerificationEmail({ email, callbackUrl? })` | `POST /api/v1/auth/send-verification-email` | Always the same generic message. |
| `requestPasswordReset({ email, redirectUrl? })` | `POST /api/v1/public/password-reset/request` | Always the same generic message. The link becomes `<redirectUrl>?token=…`. |
| `resetPassword({ token, newPassword })` | `POST /api/v1/public/password-reset/confirm` | 400 for an invalid or expired token. |
| `changePassword({ currentPassword, newPassword, revokeOtherSessions? })` | `POST /api/v1/auth/change-password` | Needs a session; signs out other devices by default. |
| `twoFactor.enable / verifyTotp / verifyBackupCode / disable / generateBackupCodes` | `/api/v1/auth/two-factor/*` | TOTP plus backup codes only (no SMS/email codes). |

Failures throw `KenresoftApiError` with `status`, `message`, and, for better-auth errors, a machine-readable `code`. Password-reset and verification responses are deliberately generic so they never reveal whether an account exists. Auth requests are also rate limited server-side (429).

### Commerce

`client.commerce.customerAuth.*` and `client.commerce.customer.changePassword()` call `client.auth` under the hood, so a session created either way is the same session the cart, checkout, and account routes read. `commerce.customerAuth.login()` returns the customer profile. For a two-factor account it rejects with `code: 'TWO_FACTOR_REQUIRED'`; catch that, ask for the code, and call `commerce.customerAuth.verifyTwoFactor({ code })` (or `{ code, method: 'backup-code' }`), which resolves the customer.

## Local development

```bash
cd examples/astro-site
cp .env.example .env   # set PUBLIC_KENRESOFT_CMS_URL to your local or deployed API
pnpm dev
```

Requires a running CMS API to fetch from. Either `wrangler dev` locally
(`pnpm --filter @kenresoft-cms/api dev` from the repo root) or a real deployed API Worker.

## Relationship with the CMS API

This package has no relationship with the CMS beyond being an HTTP client of its public API:
same trust boundary as any external consumer, same endpoints anyone could call directly. It holds
no credentials, calls no admin-gated routes, and has no server-side counterpart of its own. If a
future need arises for the same client to also read *unpublished* content or manage entries,
that's a materially different (admin-authenticated) surface this package deliberately doesn't
touch.
