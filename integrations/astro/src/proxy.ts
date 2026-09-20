// A same-origin proxy for the CMS API, so a site's session cookie is first-party to the site.
//
// Without it, the API's session cookie belongs to the API's own origin: the site's server never
// sees it (no SSR session checks) and browsers that block third-party cookies drop it entirely.
// With it, the browser talks only to the site (`/cms/*`), the site forwards to the API, and the
// API's Set-Cookie lands on the site's own host — so both the browser and SSR see it, on any
// domain layout (including two unrelated *.workers.dev hosts, where a shared-parent-domain
// cookie is impossible).
//
// Framework-agnostic: a plain (Request) => Response handler. In Astro:
//
//   // src/pages/cms/[...path].ts
//   import { createCmsProxy } from '@kenresoft-cms/astro';
//   const proxy = createCmsProxy({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL, trustedProxySecret: import.meta.env.TRUSTED_PROXY_SECRET });
//   export const ALL = ({ request }) => proxy(request);
//
// Security: only the public/auth surface is forwarded, never /api/v1/admin/* — the proxy is a
// door for visitors, not a way to expose the admin API through the site.

export interface CmsProxyOptions {
  /** The CMS API's real base URL, e.g. "https://api.example.com". */
  url: string;
  /** The path prefix this proxy is mounted at on your site. Defaults to "/cms". */
  basePath?: string;
  /**
   * Must equal the API's `TRUSTED_PROXY_SECRET` Worker secret. Lets the API rate-limit real
   * visitors individually instead of lumping everyone behind the proxy's own address. Keep it
   * server-only (never a PUBLIC_ variable). Without it everything still works, but per-IP rate
   * limits then see one shared client.
   */
  trustedProxySecret?: string;
  /** Override for testing — defaults to the global fetch. */
  fetch?: typeof fetch;
}

const FORWARDED_REQUEST_HEADERS = ['cookie', 'content-type', 'accept', 'accept-language', 'idempotency-key', 'origin', 'user-agent'];
const STRIPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

export function isProxiedPathAllowed(path: string): boolean {
  return (
    path.startsWith('/api/v1/auth/') ||
    path.startsWith('/api/v1/public/') ||
    /^\/api\/plugins\/[^/]+\/public\//.test(path)
  );
}

export function createCmsProxy(options: CmsProxyOptions): (request: Request) => Promise<Response> {
  const upstreamBase = options.url.replace(/\/$/, '');
  const basePath = (options.basePath ?? '/cms').replace(/\/$/, '');
  const doFetch = options.fetch ?? fetch;

  return async (request) => {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith(`${basePath}/`)) return new Response('Not found', { status: 404 });

    // URL parsing already collapsed any `..` segments, so this can't climb out of the allow-list.
    const upstreamPath = incoming.pathname.slice(basePath.length);
    if (!isProxiedPathAllowed(upstreamPath)) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (options.trustedProxySecret) {
      const clientIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (clientIp) {
        headers.set('x-kenresoft-proxy-secret', options.trustedProxySecret);
        headers.set('x-kenresoft-client-ip', clientIp);
      }
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await doFetch(`${upstreamBase}${upstreamPath}${incoming.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      // Pass redirects (e.g. the email-verification link's callback) to the browser untouched.
      redirect: 'manual',
    });

    // Headers (including every Set-Cookie) pass straight through; fetch has already decoded the
    // body, so the encoding/length headers describing the original bytes must go.
    const responseHeaders = new Headers(upstream.headers);
    for (const name of STRIPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  };
}
