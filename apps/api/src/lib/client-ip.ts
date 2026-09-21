import { constantTimeEqual } from 'better-auth/crypto';

// The one place "which client is this?" is decided, for every per-IP rate limiter and better-auth's
// own IP tracking. Normally that's CF-Connecting-IP, which Cloudflare's edge sets and a client
// can't spoof. Behind a same-origin proxy (the frontend forwarding /cms/* here so the session
// cookie is first-party — see @kenresoft-cms/astro's createCmsProxy) every request instead
// arrives from the proxy's own address, which would put every visitor in one shared rate-limit
// bucket. So when TRUSTED_PROXY_SECRET is configured, a request that presents that exact secret
// in x-kenresoft-proxy-secret is trusted to name the real visitor in x-kenresoft-client-ip.
// Without the secret (the default: unset) neither header is ever read, so a browser can't use
// them to pick its own rate-limit bucket.
export const PROXY_SECRET_HEADER = 'x-kenresoft-proxy-secret';
export const PROXY_CLIENT_IP_HEADER = 'x-kenresoft-client-ip';

export function getClientIp(headers: Headers | undefined, env: { TRUSTED_PROXY_SECRET?: string }): string {
  const secret = env.TRUSTED_PROXY_SECRET;
  if (secret && headers) {
    const presented = headers.get(PROXY_SECRET_HEADER);
    const forwarded = headers.get(PROXY_CLIENT_IP_HEADER);
    if (presented && forwarded && constantTimeEqual(presented, secret)) {
      return forwarded.slice(0, 64);
    }
  }
  return headers?.get('CF-Connecting-IP') ?? 'local-dev';
}
