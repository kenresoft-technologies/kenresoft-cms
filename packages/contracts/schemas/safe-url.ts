import { z } from 'zod';

// Shared allow-list for every user-suppliable "link" field across the Site Builder (block
// ctaUrl/buttonUrl, Structured Settings navigation/social/footer links) — server-side, not just
// the Admin rich-text editor's own client-side `isSafeUrl()` check
// (apps/admin/src/components/rich-text-editor.tsx), which a direct API call bypasses entirely.
// Relative paths (no scheme, e.g. "/about" or "#section") are allowed — a navigation/footer
// link routinely points within the same site — but any URL that DOES specify a scheme must use
// one of the three below, closing off `javascript:`/`data:`/`vbscript:` and every other
// executable-content scheme.
const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto'];

// Matches a URI scheme prefix per RFC 3986 (a letter, then letters/digits/+/-/.  , then ':') —
// used to distinguish "this value has an explicit scheme" from "this is a relative path". No
// `URL` global here: this package has no DOM/Node lib assumption (it's imported by the Workers
// API, the Vite-built admin SPA, and Node scripts alike), so scheme extraction is a plain regex
// rather than relying on WHATWG URL parsing being available everywhere.
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

function isSafeUrlValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Two backslashes/slashes at the start (protocol-relative, "//evil.example.com") resolve
  // against whatever scheme the page is loaded over — treated as unsafe rather than assumed
  // http(s), since it's indistinguishable from a same-scheme absolute URL to an attacker-chosen
  // host.
  if (trimmed.startsWith('//')) return false;
  const match = SCHEME_PATTERN.exec(trimmed);
  if (!match) return true; // no scheme at all — a relative path/fragment, always safe
  return ALLOWED_URL_SCHEMES.includes(match[1]!.toLowerCase());
}

export function safeUrlSchema(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine(isSafeUrlValue, { message: 'URL must be a relative path or use http:, https:, or mailto:' });
}

// Optional variant for fields that may be omitted entirely but, once provided, still must be
// safe — an empty optional field should just not be sent, not accepted as "safe by omission".
export function safeUrlSchemaOptional(maxLength: number) {
  return safeUrlSchema(maxLength).optional();
}
