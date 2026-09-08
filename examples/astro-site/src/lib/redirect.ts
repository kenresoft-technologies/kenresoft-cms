// Guards the ?redirect= query param every auth page accepts against being turned into an
// open-redirect primitive — only ever a same-site, path-only value is honored.
export function sanitizeRedirect(value: string | null, fallback = '/account'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
