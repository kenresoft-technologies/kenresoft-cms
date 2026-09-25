import type { APIRoute } from 'astro';
// @ts-ignore -- resolved by the Cloudflare adapter at build time; typed via `wrangler types` or your env.d.ts
import { env } from 'cloudflare:workers';
import { createCmsProxy } from '@kenresoft-cms/astro';

// Same-origin proxy to your CMS API: visitors only ever talk to this site, so the session cookie is
// first-party. Only the public and auth surface is forwarded, never the admin API.
//
// TRUSTED_PROXY_SECRET (optional but recommended): set the same value here as a Worker secret
// (`wrangler secret put TRUSTED_PROXY_SECRET`) and on the CMS API, so the API's per-IP rate limits
// see each real visitor instead of this Worker's address. It is read from the runtime env, and must
// never be a PUBLIC_ variable.
//
// The CMS URL is read from the Worker's runtime vars first (PUBLIC_KENRESOFT_CMS_URL in your
// Wrangler config or the dashboard), then from the build (.env or a Cloudflare Build variable).
// A deploy built without the variable still works as long as the Worker has it at runtime.
export const prerender = false;

const cmsUrl = () =>
  (typeof env.PUBLIC_KENRESOFT_CMS_URL === 'string' && env.PUBLIC_KENRESOFT_CMS_URL) ||
  import.meta.env.PUBLIC_KENRESOFT_CMS_URL;

export const ALL: APIRoute = ({ request }) =>
  createCmsProxy({
    url: cmsUrl(),
    trustedProxySecret: typeof env.TRUSTED_PROXY_SECRET === 'string' ? env.TRUSTED_PROXY_SECRET : undefined,
  })(request);
