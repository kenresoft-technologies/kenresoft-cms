#!/usr/bin/env node
// Generates dist/_headers after every build — Cloudflare Workers Static Assets support the same
// `_headers` convention as Cloudflare Pages (a plain file, no extension, at the root of the
// assets directory), but it's a static file with no templating of its own, and this app's CSP
// genuinely needs one build-time value that isn't static: VITE_API_URL, which differs per
// deployment and is already required for the Vite build itself. Generating this file from the
// same env var the build already needs keeps both in sync automatically instead of hand-copying
// a URL into a second committed config.
//
// Deliberately NOT a static, checked-in `apps/admin/public/_headers` — see above.
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_DIR = join(ADMIN_DIR, 'dist');

const apiUrl = process.env.VITE_API_URL;
if (!apiUrl) {
  throw new Error(
    'VITE_API_URL must be set when building — it is baked into both the app bundle (fetch calls) ' +
      'and this generated dist/_headers file (CSP connect-src/img-src).',
  );
}

// The dark-mode bootstrap in index.html is the app's only inline <script> — CSP allows it via a
// hash instead of 'unsafe-inline' so an actual injected script still can't execute. Computed
// from the real built output rather than hard-coded, so it can never silently drift from
// whatever Vite/index.html actually ships.
const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
const inlineScriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!inlineScriptMatch) {
  throw new Error(
    'Expected an inline <script> in dist/index.html (the dark-mode bootstrap) to hash for CSP ' +
      "script-src — has index.html's shape changed? Update this script to match if so.",
  );
}
const scriptHash = createHash('sha256').update(inlineScriptMatch[1], 'utf8').digest('base64');

const csp = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${scriptHash}'`,
  // Radix UI (dropdowns/dialogs/popovers) and cmdk (the command palette) apply computed inline
  // `style` attributes at runtime for positioning — a different value on every render, so no
  // static nonce or hash can cover it. Verified empirically: a real report-only CSP without this
  // logged real violations from those exact components; adding it and re-running the same
  // browser walkthrough (sign-up, user menu, command palette, media-upload dialog, settings)
  // produced zero violations and zero console errors.
  "style-src 'self' 'unsafe-inline'",
  // The API origin is required here (not just 'self') for the admin-gated media file endpoint,
  // used directly as <img src> (apps/admin/src/lib/queries/media.ts's mediaFileUrl()).
  `img-src 'self' data: ${apiUrl}`,
  "font-src 'self'",
  // Same reasoning as img-src — every fetch()/XHR this app makes (api-client.ts, auth-client.ts)
  // targets the API Worker's own origin, not this one.
  `connect-src 'self' ${apiUrl}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// Matches apps/api/src/middleware/security-headers.ts's set for the same reasons, minus its CSP
// (replaced with the app-appropriate one above — the API's own `default-src 'none'` would blank
// the entire SPA, since unlike API JSON responses this document actually loads scripts/styles/
// fonts/images).
const headers = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Frame-Options: DENY
`;

writeFileSync(join(DIST_DIR, '_headers'), headers);
console.log(`Wrote dist/_headers (CSP scoped to API origin ${apiUrl}).`);
