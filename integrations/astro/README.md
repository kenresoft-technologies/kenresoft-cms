# @kenresoft/astro — Astro Integration

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

Inside this monorepo (e.g. from `examples/astro-site`), it's a normal workspace dependency:

```json
{ "dependencies": { "@kenresoft/astro": "workspace:*" } }
```

Outside this monorepo — using this integration in your **own**, separately-hosted Astro project
against your own Kenresoft CMS deployment — this package isn't published to npm yet; copy
`integrations/astro/src` into your project, or vendor it, until that changes.

## Configuration

One required value: the URL of your deployed API Worker (or `http://localhost:8787` for local
development against the API running via `wrangler dev`). `examples/astro-site` reads this from
`PUBLIC_KENRESOFT_CMS_URL` (Astro's `PUBLIC_` prefix so it's available client-side), but this
package itself takes it as a plain constructor argument — see "Usage" below.

## Usage

```ts
import { createKenresoftClient, KenresoftApiError } from '@kenresoft/astro';

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
(`pnpm --filter @kenresoft/api dev` from the repo root) or a real deployed API Worker.

## Relationship with the CMS API

This package has no relationship with the CMS beyond being an HTTP client of its public API —
same trust boundary as any external consumer, same endpoints anyone could call directly. It holds
no credentials, calls no admin-gated routes, and has no server-side counterpart of its own. If a
future need arises for the same client to also read *unpublished* content or manage entries,
that's a materially different (admin-authenticated) surface this package deliberately doesn't
touch.
