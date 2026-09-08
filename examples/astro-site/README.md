# Kenresoft CMS — Astro reference storefront

A real, full-featured reference site for Kenresoft CMS, built entirely on top of the typed
`@kenresoft-cms/astro` client — content, media, forms, and the full Commerce plugin (catalog,
cart, checkout, Paystack payments, customer accounts). See [`docs/ASTRO.md`](../../docs/ASTRO.md)
and [`docs/PLUGINS.md`](../../docs/PLUGINS.md) for the underlying platform docs; this README
covers only what's specific to this example.

Server-rendered (`output: 'server'`, `@astrojs/cloudflare`) — every page fetches from the CMS at
**request** time, so a published edit or a new order is visible on the very next request, no
rebuild needed.

## Site map

| Route | Backed by |
| --- | --- |
| `/` | Static hero + `blog-post` entries |
| `/about`, `/contact` | `page` content-type entries (+ a real `contact` form submission) |
| `/blog`, `/blog/[slug]` | `blog-post` entries — draft/nonexistent both 404 identically |
| `/categories/[slug]` | `category` entries, filtering `blog-post` entries by a reference field |
| `/shop`, `/shop/[slug]` | Commerce catalog (categories/products/variants/images) |
| `/cart`, `/checkout`, `/order/[id]` | Commerce cart/checkout/payments |
| `/account/login`, `/register`, `/forgot-password`, `/reset-password` | Commerce customer auth |
| `/account`, `/account/orders[/[id]]`, `/account/addresses`, `/account/settings` | Commerce customer profile/order-history (real, server-verified protected routes) |
| `/privacy`, `/terms` | Static demo content — **not** CMS-backed (see below) |

## Architecture notes

- **All data access goes through `@kenresoft-cms/astro`** (`src/lib/site-client.ts` for SSR
  reads, `src/lib/browser-client.ts` for client-side mutations) — no raw `fetch` calls to the
  API anywhere in `src/pages`. The client's `commerce.customerAuth`/`commerce.customer`
  namespaces were added to the package as part of this rebuild (they already had backend routes,
  just no client wrapper yet).
- **SSR vs. client-side split**: a page's initial render (including every `/account/*` page's
  real, server-verified auth check — see `requireCustomerOrRedirect` in `site-client.ts`) forwards
  the incoming request's own cookies to the API server-side. Every *mutation* (login, add-to-cart,
  checkout, ...) runs from a `<script>` tag as a real browser `fetch`, so the browser's own cookie
  jar handles whatever the API sets back — see `site-client.ts`'s top comment for why a server-side
  fetch can't do that without manually proxying `Set-Cookie`.
- **Checkout idempotency** (`src/lib/checkout-idempotency.ts`): one key per checkout *attempt*,
  minted on first submit and reused across retries; only rotated on a definitive rejection (an
  empty cart, out-of-stock, ...), never on a bare network failure or a 409-in-progress — matching
  the backend's own real DB-constraint-backed idempotency (see `docs/PLUGINS.md`'s Commerce
  Phase 2d entries).
- **Guest order confirmation** (`src/lib/order-cache.ts`): there's no public "get order by id"
  route for a guest (only a signed-in customer's own `GET /customer/orders/:id`), so a guest's
  full order (with line items) is cached in `sessionStorage` right after checkout — an honestly
  documented gap, not a fake endpoint. `/order/[id]` falls back to a customer session lookup, then
  to a plain "we can't find this order here" explanation if neither is available.

## Prerequisites: seeding a fresh deployment

This site assumes a specific set of content types/entries/products exists — a fresh Kenresoft CMS
deployment has none of that yet. `scripts/seed.mjs` creates all of it against a **local dev**
deployment via the real admin/public APIs (never a shared/production one — read it before pointing
it anywhere else):

```bash
# 1. Start the API (from the repo root) — see the root README for the full local-dev setup.
pnpm --filter @kenresoft-cms/api dev

# 2. Seed content types, entries, media, a "contact" form, and a small Commerce catalog.
cd examples/astro-site
API_URL=http://localhost:8787 node scripts/seed.mjs

# 3. Run this site.
cp .env.example .env   # points at your local API; edit if it's not on :8787
pnpm dev                # http://localhost:4321
```

The seed script's own comments describe exactly what it creates and why — read it rather than
running it blind against anything other than a disposable local dev instance. The first account it
creates becomes this deployment's Owner (docs/ARCHITECTURE.md §10); its login is printed at the
end of the script's output.

## Known gaps (found and left honest, not silently faked)

- **No public content-type-metadata or nav/menu API.** The header/footer nav (`src/components/
  layout/{Header,Footer}.astro`) is hardcoded — there's genuinely nothing to fetch it from (see
  `docs/ASTRO.md`'s own note on this). Site-wide config that *does* have a real API
  (Global Variables) isn't used by this rebuild since nothing here needed key/value site config
  beyond nav, which isn't backed at all.
- **SEO fields are a convention, not a schema.** `Entry.data` has no fixed shape — this example's
  `page`/`blog-post` content types use plain `metaTitle`/`metaDescription` text fields (created by
  `seed.mjs`) rendered into `<title>`/`<meta description>`/canonical/OG tags by `BaseLayout.astro`.
  Any Kenresoft CMS deployment could add the same fields; there's no dedicated SEO API to build
  against instead.
- **No public guest order lookup.** Covered above (`order-cache.ts`) — a real, load-bearing gap
  in the public API surface, not a frontend shortcut.
- **The `/shop` listing fetches every product's own detail in parallel** to get a thumbnail/
  stock/variant signal, since the list endpoint (`packages/plugin-ecommerce/src/routes/public.ts`)
  deliberately carries no images/variants. Fine for a reference catalog's size; a much larger one
  would want the list endpoint itself extended with a thumbnail field.
- **`/privacy` and `/terms`** are static placeholders — no legal-content content type exists on
  this deployment, and inventing one just to fill a footer link would be exactly the kind of fake
  CMS data this rebuild was told not to add.

## Scripts

- `pnpm dev` / `pnpm build` / `pnpm preview` — the usual Astro commands.
- `pnpm typecheck` — `astro check` over every `.astro`/`.ts` file.
- `node scripts/seed.mjs` — see above.
