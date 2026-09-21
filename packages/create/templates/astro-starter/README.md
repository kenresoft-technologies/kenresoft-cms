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

## Accounts and sign-in (already wired)

Register, log in, verify email, reset password, two-factor and a protected `/account` page are included under `src/pages/account/`. Style them however you like; they're plain Astro pages using `browserCms.auth` (in the browser) and `cmsForRequest(request).auth` (server-side).

How the pieces fit:

- **The proxy** (`src/pages/cms/[...path].ts`) forwards `/cms/*` to your CMS API, so the session cookie is first-party to *your* site. That is what keeps sign-in working in Safari and in Firefox with third-party cookies blocked, and what lets server-rendered pages see who is signed in. Only the public and auth surface is forwarded, never the admin API. Browser code uses `src/lib/browser-cms.ts` (talks to `/cms`).
- **`wrangler.jsonc`** sets `global_fetch_strictly_public`. On Cloudflare, without it this Worker calling your API Worker fails with `error code: 1042` (shown as a 404).

Before it works against a deployed CMS:

1. Add this site's origin (for example `https://www.example.com`) to the CMS API's `CORS_ORIGINS`.
2. Set up real email on the CMS (`EMAIL_PROVIDER`, `EMAIL_FROM`, and `RESEND_API_KEY` or the Cloudflare email binding). Every account must verify its email before signing in.
3. Recommended: set the same `TRUSTED_PROXY_SECRET` on the CMS API and on this Worker (`wrangler secret put TRUSTED_PROXY_SECRET` in both), so per-visitor rate limits work behind the proxy.
4. Optional bot protection on register: create a Cloudflare Turnstile widget, set `PUBLIC_TURNSTILE_SITE_KEY` here and `TURNSTILE_SECRET_KEY` on the API.

The full checklist is in the official docs: <https://docs.kenresoft.com/cms/astro/authentication/>.

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
