# Kenresoft CMS — Astro example

A minimal, standalone Astro site that renders published content from a Kenresoft CMS
deployment's **public** API (`/api/v1/public/...` — no auth, no database access). It exists to
demonstrate the intended shape of Phase 8 (`docs/ARCHITECTURE.md` §20: "Astro integration and
Pathvera production integration") — this is a generic reference, not the real Pathvera site.

This is **not** part of the repo's pnpm workspace. A real Astro site consuming a Kenresoft CMS
deployment lives in its own project, possibly its own repo entirely — this example is set up
the same way on purpose, with its own `package.json` and `node_modules`.

## What it does

- `src/lib/cms.ts` — a small `fetch`-based client for the public API, typed by hand (not
  imported from `@kenresoft/contracts`, since an external site wouldn't have access to that
  package).
- `/blog` — lists every published entry of a `blog-post` content type
  (`GET /api/v1/public/blog-post`).
- `/blog/:slug` — renders one entry by slug (`GET /api/v1/public/blog-post/:slug`), including
  its rich-text body field as HTML.
- Static output (`astro.config.mjs`) — every page fetches at **build time**. Rebuild the site
  to pick up newly published or edited entries; there's no live revalidation here.

## Prerequisites

This assumes a running Kenresoft CMS (`apps/api` + `apps/database` migrated — see the root
`README.md`) with:

1. A content type whose **slug** is `blog-post` (the display name doesn't matter — the public
   API is addressed by slug).
2. Fields on it named `title`, `excerpt`, and `body` (a rich-text field) — or edit
   `src/pages/blog/index.astro` / `src/pages/blog/[slug].astro` to match whatever field names
   you actually used. `Entry.data` has no fixed schema; these three names are this example's
   convention, not something the API enforces.
3. At least one entry of that content type with `status: published`.

## Known limitation: no public media endpoint yet

The public API only exposes entry data — there's currently no unauthenticated route for
serving R2-backed media files (the only file-serving route, `GET /api/v1/admin/media/:id/file`,
sits behind admin auth). A cover-image field on your Blog Post content type won't be
renderable from this example until that gap is closed.

## Running it

```bash
cd examples/astro-site
pnpm install --ignore-workspace   # this repo's pnpm-workspace.yaml doesn't list examples/*,
                                   # and a plain `pnpm install` here would silently no-op
cp .env.example .env               # points at your local API; edit if it's not on :8787
pnpm dev
```

`pnpm build` produces a static `dist/` you can preview with `pnpm preview`. `pnpm typecheck`
runs `astro check` over the `.astro` files.
