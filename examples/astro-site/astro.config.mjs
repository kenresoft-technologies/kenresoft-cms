import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// SSR on Cloudflare Pages Functions: every page fetches from the Kenresoft CMS public API at
// request time, not build time. New/edited published entries show up immediately — no rebuild
// needed. This replaced an earlier static-output design specifically because static output's
// getStaticPaths() froze the blog's route list at build time, so a brand-new post 404'd on the
// live site until the next manual rebuild. The public API still has its own edge cache
// (docs/ARCHITECTURE.md §12), so per-request fetches here aren't hitting D1 directly.
export default defineConfig({
  output: 'server',
  // session: false — this site has no server-side session state of its own (every page is a
  // stateless per-request fetch from the CMS's public API); the adapter otherwise auto-wires a
  // KV session driver by default (@astrojs/cloudflare v14, confirmed via its own changelog),
  // which needs real local KV simulation this project never provisions (no wrangler.jsonc here
  // at all — deliberately, since this example has no bindings of its own to declare) and was
  // crashing `astro dev`'s real-workerd dev server before it could become ready.
  adapter: cloudflare({ session: false }),
});
