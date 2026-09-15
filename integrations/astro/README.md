# @kenresoft-cms/astro — Astro Integration

A typed client for consuming a Kenresoft CMS deployment's **public API** from Astro (or any other
JS/TS frontend). This is not a CMS component, not a Cloudflare Worker, and not independently
deployable — it's a library your own site's codebase depends on, the same way it might depend on
any other API client.

Do not confuse this with the **Admin Worker** (`apps/admin`) — that's the CMS's own management
dashboard. This integration is for the separate site/frontend that *reads* content from the CMS,
typically a marketing site or blog built on Astro. See [`examples/astro-site`](../../examples/astro-site)
for a complete, working reference site built on this package, and
[`docs/ASTRO.md`](../../docs/ASTRO.md) for the fuller guide (static vs SSR, current limitations).

## What it does

Wraps the CMS's public REST API (`GET /api/v1/public/*` on the [API Worker](../../apps/api/README.md))
in a small, typed client: listing/fetching entries, resolving media file URLs, and submitting
public forms. It's plain `fetch()` underneath — nothing in `src/index.ts` is actually
Astro-specific, despite the package name. It's named and documented as Astro's path in because
Astro is this project's first-class, officially supported frontend integration
(`docs/ARCHITECTURE.md` §15); any other framework can call the same public REST API directly
without this package at all.

## Installation

**In your own, separately-hosted Astro project**, against your own Kenresoft CMS deployment —
this is the normal case for anyone who isn't working inside this monorepo:

```bash
npm install @kenresoft-cms/astro
# or: pnpm add @kenresoft-cms/astro / yarn add @kenresoft-cms/astro
```

**Updating to a new version later:** this package is still 0.x, so a caret range like
`^0.3.0` in your `package.json` only resolves within `0.3.x` — a plain `npm update`/`pnpm update`
(no version specified) will silently stay on your current minor version and never pick up a new
one like `0.4.0`. To actually get the latest release, install it explicitly:

```bash
npm install @kenresoft-cms/astro@latest
# or: pnpm add @kenresoft-cms/astro@latest / yarn add @kenresoft-cms/astro@latest
```

Published on npm under the `@kenresoft-cms` scope (same organization as
[`@kenresoft-cms/contracts`](../../packages/contracts) and
[`@kenresoft-cms/create`](../../packages/create)). It depends on `@kenresoft-cms/contracts` for
its own TypeScript types — installed automatically, nothing extra to add. See "Connecting your
own Astro project" below for a full walkthrough, or scaffold a starter with zero manual wiring
via `npm create @kenresoft-cms@latest my-site -- --astro` (see the root
[README](../../README.md)/[`packages/create`](../create)).

Inside this monorepo (e.g. from `examples/astro-site`), it's a normal workspace dependency
instead — `pnpm install` at the repo root symlinks it to the local, unpublished-yet-in-progress
source automatically:

```json
{ "dependencies": { "@kenresoft-cms/astro": "workspace:*" } }
```

## Connecting your own Astro project

A minimal, from-scratch example — this is everything needed, no monorepo, no workspace linking:

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
published edits without a rebuild — see `docs/ASTRO.md`'s "Static vs SSR" section for why
`examples/astro-site` made that same choice. `output: 'static'` still works with
`getStaticPaths()`, at the cost of needing a rebuild to pick up new/edited content.

## Configuration

One required value: the URL of your deployed API Worker (or `http://localhost:8787` for local
development against the API running via `wrangler dev`). `examples/astro-site` reads this from
`PUBLIC_KENRESOFT_CMS_URL` (Astro's `PUBLIC_` prefix so it's available client-side), but this
package itself takes it as a plain constructor argument — see "Usage" below.

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
server — a draft entry matching the requested slug 404s exactly like a slug that doesn't exist,
never distinguishable from the outside. There is deliberately no `contentTypes.list()` — no
public content-type-metadata endpoint exists to back one (an open product decision, not an
oversight; see `docs/ASTRO.md`).

### Live Preview (draft rendering)

Kenresoft CMS's Entry/Page Editor "Live Preview" button opens your page with
`?preview_token=...` appended. Pass it straight through and `entries.get()`/`pages.resolve()`
render the draft (or any status) through this exact same template — no separate branch needed:

```astro
---
const previewToken = Astro.url.searchParams.get('preview_token');
const post = await cms.entries.get({ contentType: 'blog-post', slug, previewToken });
---
```

Omit `previewToken` (or leave it `null`/`undefined` — exactly what `URLSearchParams.get()`
returns when the param is absent) for normal published-only rendering; that's the common case
and needs no code change from the snippet above. `entries.preview()`/`pages.preview()` also
exist as explicit standalone calls when you already have a token in hand and don't need the
published-vs-draft branch collapsed into one call.

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
definitions — this client doesn't duplicate that validation, it just surfaces the server's
response.

## Local development

```bash
cd examples/astro-site
cp .env.example .env   # set PUBLIC_KENRESOFT_CMS_URL to your local or deployed API
pnpm dev
```

Requires a running CMS API to fetch from — either `wrangler dev` locally
(`pnpm --filter @kenresoft-cms/api dev` from the repo root) or a real deployed API Worker.

## Relationship with the CMS API

This package has no relationship with the CMS beyond being an HTTP client of its public API —
same trust boundary as any external consumer, same endpoints anyone could call directly. It holds
no credentials, calls no admin-gated routes, and has no server-side counterpart of its own. If a
future need arises for the same client to also read *unpublished* content or manage entries,
that's a materially different (admin-authenticated) surface this package deliberately doesn't
touch.
