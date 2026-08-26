import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  // Must match the server's basePath (apps/api/src/lib/auth-options.ts) — kept under the
  // versioned API prefix (§8) rather than better-auth's default /api/auth.
  basePath: '/api/v1/auth',
});
