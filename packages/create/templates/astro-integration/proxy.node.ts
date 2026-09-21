import type { APIRoute } from 'astro';
import { createCmsProxy } from '@kenresoft-cms/astro';

// Same-origin proxy to your CMS API: visitors only ever talk to this site, so the session cookie is
// first-party. Only the public and auth surface is forwarded, never the admin API.
//
// TRUSTED_PROXY_SECRET (optional but recommended): set the same value here as a server-only
// environment variable and on the CMS API, so the API's per-IP rate limits see each real visitor
// instead of this server's address. It must never be a PUBLIC_ variable.
export const prerender = false;

const cmsUrl = import.meta.env.PUBLIC_KENRESOFT_CMS_URL;
const trustedProxySecret = process.env.TRUSTED_PROXY_SECRET || undefined;

export const ALL: APIRoute = ({ request }) =>
  createCmsProxy({ url: cmsUrl, trustedProxySecret })(request);
