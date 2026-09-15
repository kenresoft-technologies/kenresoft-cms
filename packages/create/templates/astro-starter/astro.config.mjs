// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// output: 'server' — every page fetches from your Kenresoft CMS at request time, so a published
// edit is visible on the very next request, no rebuild needed. See docs/ASTRO.md's "Static vs
// SSR" section (in the Kenresoft CMS repo) if you'd rather prerender with getStaticPaths().
export default defineConfig({
  output: 'server',
  // No server-side session state of its own (every page is a stateless per-request render) —
  // without this, the adapter auto-wires a KV session driver this project has no binding for.
  session: false,
  adapter: cloudflare(),
});
