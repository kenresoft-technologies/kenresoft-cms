# My Kenresoft CMS site

Scaffolded by `npm create @kenresoft-cms@latest my-site -- --astro`. A small, generic Astro
starter with [`@kenresoft-cms/astro`](https://www.npmjs.com/package/@kenresoft-cms/astro) already
wired up — no monorepo, no workspace linking, just an npm dependency.

## Setup

```bash
cp .env.example .env   # set PUBLIC_KENRESOFT_CMS_URL to your deployed API Worker's URL
pnpm install            # or npm/yarn
pnpm dev
```

Needs a running Kenresoft CMS to fetch from — either a real deployment, or `wrangler dev` from a
local clone of the CMS itself (`http://localhost:8787` by default).

## What's here

- `src/lib/cms.ts` — the one `createKenresoftClient(...)` instance every page imports.
- `src/pages/blog/{index,[slug]}.astro` — a working list/detail example against a `'blog-post'`
  content type. **Change `'blog-post'` (and the field names it reads, e.g. `title`/`body`) to
  match a real content type in your own CMS** — this is a placeholder, not a required schema.
- `src/pages/contact.astro` — a working form-submission example against a `'contact'` form slug.
  Same deal: create a matching Form in your CMS admin, or change the slug/fields to match one you
  already have.

## Where to go from here

This starter intentionally does the minimum to prove the connection works end to end. For
everything the client supports (media, Structured Settings, Global Variables, the Page/Block
site-builder, Live Preview, the Commerce plugin, ...), see:

- The [`@kenresoft-cms/astro` README](https://github.com/kenresoft-technologies/kenresoft-cms/blob/main/integrations/astro/README.md)
- [`docs/ASTRO.md`](https://github.com/kenresoft-technologies/kenresoft-cms/blob/main/docs/ASTRO.md)
  in the CMS repo
- [`examples/astro-site`](https://github.com/kenresoft-technologies/kenresoft-cms/tree/main/examples/astro-site) —
  a much larger, fuller reference site (Commerce, forms, media, customer accounts) if you want to
  see more of the surface used together, seeded against a matching CMS deployment.

Deploying this site is up to you and your own hosting choice — `@astrojs/cloudflare` is included
since Cloudflare is the CMS's own platform, but nothing here requires it specifically.
