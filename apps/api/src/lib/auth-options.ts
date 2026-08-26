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
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'editor',
        // Never client-settable at signup — only a trusted admin action may grant 'owner'.
        input: false,
      },
    },
  },
} satisfies BetterAuthOptions;
