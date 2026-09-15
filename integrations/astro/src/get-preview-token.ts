// The one small, standalone helper `createKenresoftClient`'s `previewToken` config option is
// meant to be paired with — see that option's own doc comment in index.ts for the full picture
// of why a client-level default exists at all (the global, per-page-code-free way to wire up
// Live Preview). Kept in its own module (rather than inline in index.ts) so it can be unit
// tested directly under Node's own type-stripping test runner, the same "pure logic, no
// barrel-file import" reasoning the render/ modules already follow.

/**
 * Extracts a Live Preview token from a URL/Request's own `preview_token` query parameter — the
 * exact param name the CMS admin's Entry/Page Editor "Live Preview" button appends. Returns
 * `null` when absent, so it's always safe to pass straight into
 * `createKenresoftClient({ previewToken: getPreviewToken(...) })` — the recommended, global way
 * to wire up Live Preview — or into an individual `entries.get()`/`pages.resolve()` call's own
 * `previewToken` option.
 *
 * Accepts a `URL` (e.g. Astro's `Astro.url`), an absolute URL string, or a `Request` (e.g.
 * `Astro.request`) — whatever's already at hand in your own routing code.
 */
export function getPreviewToken(input: URL | string | Request): string | null {
  const url = input instanceof Request ? new URL(input.url) : input instanceof URL ? input : new URL(input);
  return url.searchParams.get('preview_token');
}
