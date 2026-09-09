import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';

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
        developerToolsAccess: { type: 'boolean', input: false },
      },
    }),
    // Detection of a sign-in that needs a 2FA step happens by reading `twoFactorRedirect`
    // directly off signIn.email()'s own resolved data in LoginPage.tsx, not this plugin's
    // optional onTwoFactorRedirect callback — simpler, and avoids bridging a client-level
    // callback (registered once, outside React) into component state. This plugin is still
    // needed regardless: it's what adds `authClient.twoFactor.*` (enable/disable/verifyTotp/
    // verifyBackupCode/generateBackupCodes) to the client at all.
    twoFactorClient(),
  ],
});
