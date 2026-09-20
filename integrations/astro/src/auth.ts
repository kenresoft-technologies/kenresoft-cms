import { KenresoftApiError } from './errors';

// The generic frontend authentication surface. Every method is a thin call to Core's own
// better-auth mount (/api/v1/auth/*) or Core's password-reset routes (/api/v1/public/
// password-reset/*) — the one identity system CMS staff, storefront customers, and any other
// frontend account share. Nothing here knows about Commerce (or any plugin): plugins consume
// this same object rather than carrying an auth implementation of their own.
//
// Cookies: every call sends `credentials: 'include'`, so the session cookie the API sets travels
// on later calls. For a frontend on a different origin than the API, the API must list that
// origin in CORS_ORIGINS (it then answers with Access-Control-Allow-Credentials and a concrete
// Allow-Origin), and calls must run in the visitor's browser so the cookie lands in — and is
// read from — the browser's own cookie jar. See the README's "Authentication" section.

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  twoFactorEnabled?: boolean | null;
  // better-auth may return additional fields (role, etc.) depending on deployment config.
  [key: string]: unknown;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  [key: string]: unknown;
}

export interface AuthSessionData {
  user: AuthUser;
  session: AuthSession;
}

export interface SignUpOptions {
  email: string;
  password: string;
  name: string;
  /** Where the emailed verification link sends the user once verified. Must be an origin in the deployment's CORS_ORIGINS. */
  callbackUrl?: string;
}

export interface SignInOptions {
  email: string;
  password: string;
  /** Keep the session across browser restarts. Defaults to the server's own default. */
  rememberMe?: boolean;
}

/**
 * A completed sign-in resolves `{ twoFactorRequired: false, user }`. An account with two-factor
 * enabled resolves `{ twoFactorRequired: true }` instead — no session exists yet; finish with
 * `auth.twoFactor.verifyTotp()` or `auth.twoFactor.verifyBackupCode()`.
 */
export type SignInResult = { twoFactorRequired: false; user: AuthUser | null } | { twoFactorRequired: true };

export interface VerifyEmailOptions {
  token: string;
}

export interface ResendVerificationEmailOptions {
  email: string;
  /** Same meaning as SignUpOptions.callbackUrl. */
  callbackUrl?: string;
}

export interface RequestPasswordResetOptions {
  email: string;
  /** Your own reset page; the emailed link becomes `<redirectUrl>?token=...`. Must be an origin in CORS_ORIGINS, otherwise the email falls back to the admin app's page. */
  redirectUrl?: string;
}

export interface ResetPasswordOptions {
  token: string;
  newPassword: string;
}

export interface ChangePasswordOptions {
  currentPassword: string;
  newPassword: string;
  /** Sign out every other device. Defaults to true. */
  revokeOtherSessions?: boolean;
}

export interface TwoFactorEnableResult {
  totpURI: string;
  backupCodes: string[];
}

export interface AuthMessage {
  message: string;
}

export interface KenresoftAuth {
  /**
   * Creates an account and emails a verification link. Deployments require verified email, so
   * the user is NOT signed in yet — this resolves without a session. Registering an
   * already-registered email resolves identically (never reveals whether an account exists).
   */
  signUp(options: SignUpOptions): Promise<{ requiresEmailVerification: true }>;
  /**
   * Throws KenresoftApiError (401, code INVALID_EMAIL_OR_PASSWORD) for bad credentials; (403,
   * code EMAIL_NOT_VERIFIED) if the email isn't verified yet (a fresh verification email is
   * sent). See SignInResult for the two-factor case.
   */
  signIn(options: SignInOptions): Promise<SignInResult>;
  /** Idempotent — safe to call with no session. */
  signOut(): Promise<void>;
  /** The current session, or null when nobody is signed in (never throws for that case). */
  getSession(): Promise<AuthSessionData | null>;
  /** Throws KenresoftApiError for an invalid/expired token. */
  verifyEmail(options: VerifyEmailOptions): Promise<AuthMessage>;
  /** Always resolves with the same generic message regardless of whether the email matches an account or is already verified. */
  resendVerificationEmail(options: ResendVerificationEmailOptions): Promise<AuthMessage>;
  /** Always resolves with the same generic message regardless of whether the email matches an account. */
  requestPasswordReset(options: RequestPasswordResetOptions): Promise<AuthMessage>;
  /** Throws KenresoftApiError (400) for an invalid/expired token. */
  resetPassword(options: ResetPasswordOptions): Promise<AuthMessage>;
  /** Requires a session. Throws KenresoftApiError for an incorrect currentPassword. */
  changePassword(options: ChangePasswordOptions): Promise<AuthMessage>;
  /** Two-factor (TOTP + backup codes) — better-auth's `two-factor` plugin, as Core configures it. */
  twoFactor: {
    /** Requires a session and the account password. Returns the otpauth:// URI to render as a QR code, plus backup codes; call `verifyTotp()` with a first code to finish enrolling. */
    enable(options: { password: string; issuer?: string }): Promise<TwoFactorEnableResult>;
    /** Completes enrollment, or — after `signIn()` resolved `twoFactorRequired` — completes the sign-in. */
    verifyTotp(options: { code: string; trustDevice?: boolean }): Promise<void>;
    /** Completes a sign-in that `signIn()` reported as `twoFactorRequired`, using a single-use backup code. */
    verifyBackupCode(options: { code: string; trustDevice?: boolean }): Promise<void>;
    /** Requires a session and the account password. */
    disable(options: { password: string }): Promise<void>;
    /** Requires a session and the account password. Invalidates previously issued codes. */
    generateBackupCodes(options: { password: string }): Promise<{ backupCodes: string[] }>;
  };
}

export function createAuth(baseUrl: string, doFetch: typeof fetch): KenresoftAuth {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string; error?: string; code?: string } | null;
      throw new KenresoftApiError(
        response.status,
        body?.message ?? body?.error ?? `Kenresoft CMS API request failed: ${init?.method ?? 'GET'} ${path} -> ${response.status}`,
        undefined,
        body?.code,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => undefined)) as T;
  }

  const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    async signUp({ callbackUrl, ...options }) {
      await post('/api/v1/auth/sign-up/email', { ...options, ...(callbackUrl ? { callbackURL: callbackUrl } : {}) });
      return { requiresEmailVerification: true };
    },
    async signIn(options) {
      const result = await post<{ twoFactorRedirect?: boolean; user?: AuthUser } | undefined>('/api/v1/auth/sign-in/email', options);
      if (result?.twoFactorRedirect) return { twoFactorRequired: true };
      return { twoFactorRequired: false, user: result?.user ?? null };
    },
    async signOut() {
      await post('/api/v1/auth/sign-out');
    },
    async getSession() {
      // 200 with a `null` body when signed out.
      const data = await call<AuthSessionData | null | undefined>('/api/v1/auth/get-session');
      return data?.session && data.user ? data : null;
    },
    async verifyEmail({ token }) {
      await call(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
      return { message: 'Email verified.' };
    },
    async resendVerificationEmail({ callbackUrl, ...options }) {
      await post('/api/v1/auth/send-verification-email', { ...options, ...(callbackUrl ? { callbackURL: callbackUrl } : {}) }).catch(
        (err: unknown) => {
          // Same generic outcome whether or not the address needs verifying (already verified, unknown).
          if (!(err instanceof KenresoftApiError) || err.status >= 500) throw err;
        },
      );
      return { message: 'If that email is registered and not yet verified, a new verification email has been sent.' };
    },
    requestPasswordReset(options) {
      return post<AuthMessage>('/api/v1/public/password-reset/request', options);
    },
    resetPassword(options) {
      return post<AuthMessage>('/api/v1/public/password-reset/confirm', options);
    },
    async changePassword({ revokeOtherSessions = true, ...options }) {
      await post('/api/v1/auth/change-password', { ...options, revokeOtherSessions });
      return { message: 'Password changed.' };
    },
    twoFactor: {
      async enable(options) {
        const data = await post<TwoFactorEnableResult>('/api/v1/auth/two-factor/enable', options);
        return { totpURI: data.totpURI, backupCodes: data.backupCodes };
      },
      async verifyTotp(options) {
        await post('/api/v1/auth/two-factor/verify-totp', options);
      },
      async verifyBackupCode(options) {
        await post('/api/v1/auth/two-factor/verify-backup-code', options);
      },
      async disable(options) {
        await post('/api/v1/auth/two-factor/disable', options);
      },
      async generateBackupCodes(options) {
        const data = await post<{ backupCodes: string[] }>('/api/v1/auth/two-factor/generate-backup-codes', options);
        return { backupCodes: data.backupCodes };
      },
    },
  };
}
