import type { APIRoute } from 'astro';
import { createCmsProxy } from '@kenresoft-cms/astro';

// Same-origin proxy to the CMS API (visitors only ever talk to this site, so the session cookie is
// first-party — visible to SSR, and immune to third-party-cookie blocking). Only the public/auth
// surface is forwarded, never /api/v1/admin/*. If the API sets TRUSTED_PROXY_SECRET, also pass it
// here as `trustedProxySecret` (read from your platform's server-side env, never a PUBLIC_
// variable) so per-IP rate limits see each real visitor. See integrations/astro/README.md.
export const prerender = false;

const proxy = createCmsProxy({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL });

export const ALL: APIRoute = ({ request }) => proxy(request);
