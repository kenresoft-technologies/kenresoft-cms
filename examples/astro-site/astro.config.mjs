import { defineConfig } from 'astro/config';

// Static output: every page below fetches from the Kenresoft CMS public API at build time
// (docs/ARCHITECTURE.md §20.1's "Astro renders the post" step of the first vertical slice),
// the same JAMstack pattern most headless-CMS + Astro integrations use. Rebuild the site to
// pick up new/edited published entries — there's no ISR/on-demand revalidation here, since
// the public API already has its own edge cache (docs/ARCHITECTURE.md §12).
export default defineConfig({
  output: 'static',
});
