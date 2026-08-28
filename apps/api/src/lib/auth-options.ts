import type { BetterAuthOptions } from 'better-auth';

// better-auth is pinned to an exact version (not ^) because @better-auth/cli's schema
// generator bundles its own internal better-auth copy rather than using the app's — as of
// 2026-08-26 the CLI's published "latest" is stuck on the 1.4.x line while the main package
// is on 1.7.x, and generating against a newer runtime produced schema missing fields the
// 1.7.x runtime expects (e.g. "issuer" on the account table), which fails at request time,
// not at generate time. Pinning both to the exact version @better-auth/cli generates against
// keeps schema and runtime verified-consistent. Re-check this pin before bumping either
// package — see apps/api/package.json.

// §10: "starts with a small role set — Owner and Editor." A plain custom field is enough for
// that — the full `admin` plugin (impersonation, banning, org-level ac statements) is more
// surface area than this phase needs.
export const authOptions = {
  // Kept under the versioned API prefix (§8) rather than better-auth's default /api/auth.
  basePath: '/api/v1/auth',
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      // better-auth's default (`SameSite=Lax`) is fine when the admin and API share a site,
      // but they don't in every deployment shape this project actually uses: apps/admin has
      // no deployed home yet, so managing a live deployment means running it locally against
      // the remote API (docs in README.md's "Live deployment" section) — genuinely
      // cross-site, not just cross-port, from the browser's perspective. A Lax cookie is
      // still *set* by a cross-site response, but never *sent back* on the next cross-site
      // request, so the very next session check silently fails — the sign-in POST succeeds
      // (a real account gets created/authenticated server-side) while the browser never
      // becomes visibly signed in. `None` requires `Secure` — not just "every real deployment
      // already uses HTTPS", but a hard requirement of the SameSite=None cookie spec itself: a
      // browser drops the cookie outright if Secure isn't literally present in the header,
      // regardless of the connection's actual scheme. better-auth only sets Secure
      // automatically when it infers HTTPS from BETTER_AUTH_URL/the request, which is false
      // for local dev's plain-http Worker — silently breaking sign-in there (caught by the
      // apps/admin Playwright E2E suite: the sign-up API call succeeded and returned a
      // Set-Cookie header, but Chromium never sent it back on the next request, because that
      // header had SameSite=None with no Secure). Forcing secure:true unconditionally is safe
      // specifically because Chromium and other major browsers already treat `localhost` as a
      // secure context and accept a Secure cookie set over plain HTTP there.
      sameSite: 'none',
      secure: true,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'editor',
        // Never client-settable at signup — only a trusted admin action may grant a role
        // above 'editor'.
        input: false,
      },
    },
  },
} satisfies BetterAuthOptions;
