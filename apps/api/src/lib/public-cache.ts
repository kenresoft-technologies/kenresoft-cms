// Edge caching for the public content API (§12): the Cloudflare Cache API only — Workers KV
// as a secondary read-through layer is documented (§12) but not implemented yet (cross-colo
// consistency isn't a concern at Pathvera's current single-region traffic, so the simpler
// single-layer cache is the right V1 scope; see CLAUDE.md).
const PUBLIC_CACHE_TTL_SECONDS = 300;

// The Cache API keys entries by full request URL (scheme + host + path), but the real host a
// request arrives on can vary (custom domains, workers.dev, local dev) and the scheduled
// auto-publish trigger has no incoming request to read a host from at all. Cache reads,
// writes, and invalidations all construct keys against this fixed internal origin instead of
// the request's real one, so they always agree with each other regardless of how the worker
// was actually reached.
const CACHE_KEY_ORIGIN = 'https://public-cache.internal';

export function publicCacheKey(pathname: string): Request {
  return new Request(`${CACHE_KEY_ORIGIN}${pathname}`, { method: 'GET' });
}

export function publicCacheControlHeader(): string {
  return `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}`;
}

// Invalidated on every write that could change what a published-content GET returns (§13) —
// called from the admin entries routes and the scheduled auto-publish sweep — rather than
// left to expire blindly, so editors see their changes reflected promptly.
export async function invalidatePublicEntryCache(
  contentTypeSlug: string,
  entrySlug: string,
): Promise<void> {
  const cache = caches.default;
  await Promise.all([
    cache.delete(publicCacheKey(`/api/v1/public/${contentTypeSlug}`)),
    cache.delete(publicCacheKey(`/api/v1/public/${contentTypeSlug}/${entrySlug}`)),
  ]);
}
