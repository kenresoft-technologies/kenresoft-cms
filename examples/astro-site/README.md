# Kenresoft CMS — Astro example

A minimal Astro site that renders published content from a Kenresoft CMS deployment's
**public** API, via the typed `@kenresoft-cms/astro` client — no auth, no database access, no
credentials of any kind. See [`docs/ASTRO.md`](../../docs/ASTRO.md) for the full guide
(architecture, environment variables, static-vs-SSR rationale, known limitations); this is a
generic reference, not the real Pathvera site.

This **is** part of the repo's pnpm workspace (`pnpm-workspace.yaml` lists `examples/*`), so it
can depend on `@kenresoft-cms/astro` (`../../integrations/astro`) as an ordinary `workspace:*`
package — a plain `pnpm install` at the repo root wires it up via a symlink, same as any other
internal package.

## What it does

- `src/pages/blog/index.astro` — lists every published entry of a `blog-post` content type via
  `cms.entries.list({ contentType: 'blog-post' })`.
- `src/pages/blog/[slug].astro` — renders one entry by slug via
  `cms.entries.get({ contentType: 'blog-post', slug })`, including its rich-text body field as
  HTML and a "Published" date derived from the entry's `createdAt`.
- Static output (`astro.config.mjs`) — every page fetches at **build time**. Rebuild the site to
  pick up newly published or edited entries; there's no live revalidation here (`astro dev`, by
  contrast, re-fetches on every request — see `docs/ASTRO.md`).

## Prerequisites

A running Kenresoft CMS (`apps/api`, with `packages/database` migrated — see the root
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
renderable from this example until that gap is closed. See `docs/ASTRO.md`'s Known Limitations
for the rest.

## Running it

```bash
# from the repo root
pnpm install
cd examples/astro-site
cp .env.example .env   # points at your local API; edit if it's not on :8787
pnpm dev                # http://localhost:4321
```

`pnpm build` produces a static `dist/` you can preview with `pnpm preview`. `pnpm typecheck`
runs `astro check` over the `.astro` files.
