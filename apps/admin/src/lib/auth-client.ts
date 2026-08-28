import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  // Must match the server's basePath (apps/api/src/lib/auth-options.ts) — kept under the
  // versioned API prefix (§8) rather than better-auth's default /api/auth.
  basePath: '/api/v1/auth',
  plugins: [
    // Types session.user.role — mirrors the user.additionalFields in
    // apps/api/src/lib/auth-options.ts, `input: false` included: without it, the inferred
    // signUp.email() input type wrongly requires callers to supply `role` themselves, when
    // the server actually ignores any client-sent value and assigns 'editor' by default (or
    // 'admin' for the very first account) unconditionally. Described directly rather than
    // importing that server-side type, since apps/admin has no dependency on apps/api.
    inferAdditionalFields({
      user: {
        role: { type: 'string', input: false },
      },
    }),
  ],
});
