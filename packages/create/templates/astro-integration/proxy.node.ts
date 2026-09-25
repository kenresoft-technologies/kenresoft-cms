import type { APIRoute } from 'astro';
import { createCmsProxy } from '@kenresoft-cms/astro';

// Same-origin proxy to your CMS API: visitors only ever talk to this site, so the session cookie is
// first-party. Only the public and auth surface is forwarded, never the admin API.
//
// TRUSTED_PROXY_SECRET (optional but recommended): set the same value here as a server-only
// environment variable and on the CMS API, so the API's per-IP rate limits see each real visitor
// instead of this server's address. It must never be a PUBLIC_ variable.
//
// The CMS URL is read from the server's environment first, then from the build (.env), so a build
// made without the variable still works when the server has it.
export const prerender = false;

const trustedProxySecret = process.env.TRUSTED_PROXY_SECRET || undefined;

export const ALL: APIRoute = ({ request }) =>
  createCmsProxy({
    url: process.env.PUBLIC_KENRESOFT_CMS_URL || import.meta.env.PUBLIC_KENRESOFT_CMS_URL,
    trustedProxySecret,
  })(request);
