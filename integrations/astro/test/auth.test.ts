// Unit tests for the generic `client.auth` API and for Commerce's customerAuth delegating to it
// (a recording fake `fetch`, no network — same "pure logic, node --test" precedent as the other
// files here). The delegation tests assert Commerce hits the exact same Core better-auth
// endpoints, with the same request shape and credentials, as `client.auth` does — i.e. there is
// one auth implementation, not a parallel one.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createKenresoftClient, KenresoftApiError } from '../src/index.ts';

interface Recorded {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

function fakeApi(handler: (url: string, method: string) => Response | undefined = () => undefined) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, credentials: init?.credentials, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url, method) ?? Response.json({ ok: true });
  }) as typeof fetch;
  const client = createKenresoftClient({ url: 'https://cms.example.com/', fetch: fetchImpl });
  return { client, calls };
}

const B = 'https://cms.example.com';

describe('client.auth', () => {
  it('signUp posts to better-auth sign-up with callbackURL, credentials included, and never claims a session', async () => {
    const { client, calls } = fakeApi();
    const result = await client.auth.signUp({ email: 'a@b.co', password: 'pw', name: 'A', callbackUrl: 'https://site.example/verify' });
    assert.deepEqual(result, { requiresEmailVerification: true });
    assert.equal(calls[0]!.url, `${B}/api/v1/auth/sign-up/email`);
    assert.equal(calls[0]!.credentials, 'include');
    assert.deepEqual(calls[0]!.body, { email: 'a@b.co', password: 'pw', name: 'A', callbackURL: 'https://site.example/verify' });
  });

  it('signIn resolves the user, and reports twoFactorRequired instead of pretending to be signed in', async () => {
    const ok = fakeApi(() => Response.json({ user: { id: 'u1', email: 'a@b.co', name: 'A', emailVerified: true } }));
    const result = await ok.client.auth.signIn({ email: 'a@b.co', password: 'pw' });
    assert.equal(result.twoFactorRequired, false);
    assert.equal(ok.calls[0]!.url, `${B}/api/v1/auth/sign-in/email`);

    const tf = fakeApi(() => Response.json({ twoFactorRedirect: true }));
    assert.deepEqual(await tf.client.auth.signIn({ email: 'a@b.co', password: 'pw' }), { twoFactorRequired: true });
  });

  it('signIn forwards callbackUrl as callbackURL so the auto-resent verification email lands on the site', async () => {
    const { client, calls } = fakeApi(() => Response.json({ user: { id: 'u1', email: 'a@b.co', name: 'A', emailVerified: true } }));
    await client.auth.signIn({ email: 'a@b.co', password: 'pw', callbackUrl: 'https://site.example/verify' });
    assert.deepEqual(calls[0]!.body, { email: 'a@b.co', password: 'pw', callbackURL: 'https://site.example/verify' });
    await client.auth.signIn({ email: 'a@b.co', password: 'pw' });
    assert.deepEqual(calls[1]!.body, { email: 'a@b.co', password: 'pw' });
  });

  it('surfaces better-auth errors as KenresoftApiError with status, message and code', async () => {
    const { client } = fakeApi(() => Response.json({ code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' }, { status: 403 }));
    await assert.rejects(
      () => client.auth.signIn({ email: 'a@b.co', password: 'pw' }),
      (err: unknown) =>
        err instanceof KenresoftApiError && err.status === 403 && err.code === 'EMAIL_NOT_VERIFIED' && err.message === 'Email not verified',
    );
  });

  it('getSession returns null for a signed-out (null body) response and the data when signed in', async () => {
    const out = fakeApi(() => Response.json(null));
    assert.equal(await out.client.auth.getSession(), null);
    assert.equal(out.calls[0]!.url, `${B}/api/v1/auth/get-session`);

    const session = { user: { id: 'u1', email: 'a@b.co', name: 'A', emailVerified: true }, session: { id: 's1', userId: 'u1', expiresAt: 'x' } };
    const inn = fakeApi(() => Response.json(session));
    assert.deepEqual(await inn.client.auth.getSession(), session);
  });

  it('signOut, verifyEmail, changePassword hit the right Core endpoints', async () => {
    const { client, calls } = fakeApi();
    await client.auth.signOut();
    await client.auth.verifyEmail({ token: 'a b' });
    await client.auth.changePassword({ currentPassword: 'old', newPassword: 'new' });
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url.slice(B.length)}`),
      ['POST /api/v1/auth/sign-out', 'GET /api/v1/auth/verify-email?token=a%20b', 'POST /api/v1/auth/change-password'],
    );
    assert.deepEqual(calls[2]!.body, { currentPassword: 'old', newPassword: 'new', revokeOtherSessions: true });
  });

  it('uses the existing password-reset endpoints', async () => {
    const { client, calls } = fakeApi(() => Response.json({ message: 'sent' }));
    await client.auth.requestPasswordReset({ email: 'a@b.co', redirectUrl: 'https://site.example/reset' });
    await client.auth.resetPassword({ token: 't', newPassword: 'n' });
    assert.equal(calls[0]!.url, `${B}/api/v1/public/password-reset/request`);
    assert.deepEqual(calls[0]!.body, { email: 'a@b.co', redirectUrl: 'https://site.example/reset' });
    assert.equal(calls[1]!.url, `${B}/api/v1/public/password-reset/confirm`);
    assert.deepEqual(calls[1]!.body, { token: 't', newPassword: 'n' });
  });

  it('resendVerificationEmail is enumeration-safe: a 4xx still resolves the generic message, a 5xx throws', async () => {
    const four = fakeApi(() => Response.json({ message: 'nope' }, { status: 400 }));
    const result = await four.client.auth.resendVerificationEmail({ email: 'x@y.z' });
    assert.match(result.message, /If that email is registered/);

    const five = fakeApi(() => Response.json({}, { status: 500 }));
    await assert.rejects(() => five.client.auth.resendVerificationEmail({ email: 'x@y.z' }), KenresoftApiError);
  });

  it('twoFactor operations hit better-auth two-factor endpoints', async () => {
    const { client, calls } = fakeApi((url) =>
      url.endsWith('/two-factor/enable')
        ? Response.json({ totpURI: 'otpauth://x', backupCodes: ['c1'] })
        : url.endsWith('/generate-backup-codes')
          ? Response.json({ backupCodes: ['c2'] })
          : undefined,
    );
    assert.deepEqual(await client.auth.twoFactor.enable({ password: 'pw' }), { totpURI: 'otpauth://x', backupCodes: ['c1'] });
    await client.auth.twoFactor.verifyTotp({ code: '123456' });
    await client.auth.twoFactor.verifyBackupCode({ code: 'c1' });
    assert.deepEqual(await client.auth.twoFactor.generateBackupCodes({ password: 'pw' }), { backupCodes: ['c2'] });
    await client.auth.twoFactor.disable({ password: 'pw' });
    assert.deepEqual(
      calls.map((c) => c.url.slice(B.length)),
      [
        '/api/v1/auth/two-factor/enable',
        '/api/v1/auth/two-factor/verify-totp',
        '/api/v1/auth/two-factor/verify-backup-code',
        '/api/v1/auth/two-factor/generate-backup-codes',
        '/api/v1/auth/two-factor/disable',
      ],
    );
  });
});

describe('commerce.customerAuth delegates to the generic auth client', () => {
  it('register / logout / verifyEmail / password reset use the same Core endpoints and request bodies as client.auth', async () => {
    const viaAuth = fakeApi();
    const viaCommerce = fakeApi();

    await viaAuth.client.auth.signUp({ email: 'a@b.co', password: 'pw', name: 'A', callbackUrl: 'https://s/v' });
    await viaAuth.client.auth.signOut();
    await viaAuth.client.auth.verifyEmail({ token: 't' });
    await viaAuth.client.auth.requestPasswordReset({ email: 'a@b.co' });
    await viaAuth.client.auth.resetPassword({ token: 't', newPassword: 'n' });
    await viaAuth.client.auth.changePassword({ currentPassword: 'o', newPassword: 'n' });

    await viaCommerce.client.commerce.customerAuth.register({ email: 'a@b.co', password: 'pw', name: 'A', callbackUrl: 'https://s/v' });
    await viaCommerce.client.commerce.customerAuth.logout();
    await viaCommerce.client.commerce.customerAuth.verifyEmail({ token: 't' });
    await viaCommerce.client.commerce.customerAuth.requestPasswordReset({ email: 'a@b.co' });
    await viaCommerce.client.commerce.customerAuth.confirmPasswordReset({ token: 't', newPassword: 'n' });
    await viaCommerce.client.commerce.customer.changePassword({ currentPassword: 'o', newPassword: 'n' });

    assert.deepEqual(viaCommerce.calls, viaAuth.calls);
    // ...and every one of them goes to Core's own mounts, never a commerce-plugin auth route.
    for (const call of viaCommerce.calls) {
      assert.match(call.url, /^https:\/\/cms\.example\.com\/api\/v1\/(auth|public\/password-reset)\//);
    }
  });

  it('login signs in through Core better-auth, then reads the profile from the commerce customer route', async () => {
    const { client, calls } = fakeApi((url) =>
      url.endsWith('/customer')
        ? Response.json({ id: 'u1', email: 'a@b.co', name: 'A', phone: null, emailVerified: true })
        : Response.json({ user: { id: 'u1' } }),
    );
    const customer = await client.commerce.customerAuth.login({ email: 'a@b.co', password: 'pw' });
    assert.equal(customer.id, 'u1');
    assert.equal(calls[0]!.url, `${B}/api/v1/auth/sign-in/email`);
    assert.equal(calls[0]!.credentials, 'include');
    assert.equal(calls[1]!.url, `${B}/api/plugins/commerce/public/v1/customer`);
  });

  it('login rejects (rather than returning a profile) when the account needs a second factor', async () => {
    const { client, calls } = fakeApi(() => Response.json({ twoFactorRedirect: true }));
    await assert.rejects(
      () => client.commerce.customerAuth.login({ email: 'a@b.co', password: 'pw' }),
      (err: unknown) => err instanceof KenresoftApiError && err.code === 'TWO_FACTOR_REQUIRED',
    );
    assert.equal(calls.length, 1);
  });

  it('login propagates the same KenresoftApiError (status + code) client.auth.signIn throws', async () => {
    const { client } = fakeApi(() => Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, { status: 401 }));
    await assert.rejects(
      () => client.commerce.customerAuth.login({ email: 'a@b.co', password: 'bad' }),
      (err: unknown) => err instanceof KenresoftApiError && err.status === 401 && err.code === 'INVALID_EMAIL_OR_PASSWORD',
    );
  });
});

describe('cookies option and commerce two-factor completion', () => {
  it('forwards the given cookie header on every call for server-side rendering', async () => {
    const seen: (string | null)[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('cookie'));
      return Response.json(null);
    }) as typeof fetch;
    try {
      const client = createKenresoftClient({ url: B, cookies: 'session=abc' });
      await client.auth.getSession();
      assert.deepEqual(seen, ['session=abc']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('verifyTwoFactor completes through auth.twoFactor, then returns the customer profile', async () => {
    const { client, calls } = fakeApi((url) =>
      url.endsWith('/customer') ? Response.json({ id: 'u1', email: 'a@b.co', name: 'A', phone: null, emailVerified: true }) : undefined,
    );
    const customer = await client.commerce.customerAuth.verifyTwoFactor({ code: '123456' });
    await client.commerce.customerAuth.verifyTwoFactor({ code: 'bk', method: 'backup-code' });
    assert.equal(customer.id, 'u1');
    assert.deepEqual(
      calls.map((c) => c.url.slice(B.length)),
      [
        '/api/v1/auth/two-factor/verify-totp',
        '/api/plugins/commerce/public/v1/customer',
        '/api/v1/auth/two-factor/verify-backup-code',
        '/api/plugins/commerce/public/v1/customer',
      ],
    );
    assert.deepEqual(calls[0]!.body, { code: '123456' });
  });
});
