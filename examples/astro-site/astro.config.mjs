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
  adapter: cloudflare(),
});
