import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createCmsProxy } from '@kenresoft-cms/astro';

// Same-origin proxy to the CMS API (visitors only ever talk to this site, so the session cookie is
// first-party — visible to SSR, and immune to third-party-cookie blocking). Only the public/auth
// surface is forwarded, never /api/v1/admin/*.
//
// TRUSTED_PROXY_SECRET is optional: set the same value as a Worker secret here
// (`wrangler secret put TRUSTED_PROXY_SECRET`) and on the API, so the API's per-IP rate limits see
// each real visitor instead of this Worker's address. It's read from the runtime env (a secret is
// not available to `import.meta.env`, which is fixed at build time). See integrations/astro/README.md.
export const prerender = false;

const cmsUrl = import.meta.env.PUBLIC_KENRESOFT_CMS_URL;

export const ALL: APIRoute = ({ request }) =>
  createCmsProxy({ url: cmsUrl, trustedProxySecret: typeof env.TRUSTED_PROXY_SECRET === 'string' ? env.TRUSTED_PROXY_SECRET : undefined })(request);
