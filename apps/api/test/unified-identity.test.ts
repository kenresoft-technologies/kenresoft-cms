import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestEmails } from '../src/lib/email';
import {
  extractVerificationToken,
  registerWebsiteUser,
  signUpVerifiedAndGetCookie,
  withExpectedInternalRejection,
} from './helpers/auth';

// One identity system for CMS staff and website/application users (e.g. Commerce customers):
// better-auth's `user`/`account`/`session`. A website user is simply a user with role 'none'.
//
// AUTH_RATE_LIMITER's bucket (10 POST/60s) persists across every it() in a file, so this file keeps
// its real HTTP auth POSTs to a handful and creates the rest of its users through better-auth's
// server-side API (registerWebsiteUser).
const PASSWORD = 'correct horse battery staple';
const AUTH = 'https://example.com/api/v1/auth';
const CUSTOMER = 'https://example.com/api/plugins/commerce/public/v1/customer';
const ALLOWED_ORIGIN = 'http://localhost:5173';

async function post(path: string, body: unknown, cookie?: string) {
  return SELF.fetch(`${AUTH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function roleOf(email: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT role FROM user WHERE email = ?').bind(email).first<{ role: string }>();
  return row?.role;
}

describe('unified identity (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('a public sign-up creates a user with NO CMS access (role none), and the same account works as a Commerce customer', async () => {
    const signUp = await post('/sign-up/email', { email: 'shopper@example.test', password: PASSWORD, name: 'Shopper' });
    expect(signUp.status).toBe(200);
    expect(await roleOf('shopper@example.test')).toBe('none');

    // Verify + sign in server-side (this test's HTTP POST budget is small), then use the session.
    const { cookie } = await registerWebsiteUser('shopper2@example.test');

    // The session is the core session: better-auth itself recognizes it...
    const session = await SELF.fetch(`${AUTH}/get-session`, { headers: { Cookie: cookie } });
    expect(await session.json()).toMatchObject({ user: { email: 'shopper2@example.test', role: 'none' } });

    // ...and Commerce accepts that very same cookie as the customer session (no separate cookie).
    const me = await SELF.fetch(CUSTOMER, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: 'shopper2@example.test', name: 'Test Customer' });
  });

  it('a website user has no CMS access: every admin and plugin-admin route refuses them, unlike an actual CMS user', async () => {
    const { cookie: none } = await registerWebsiteUser('none-user@example.test');
    const staff = await signUpVerifiedAndGetCookie('staff-user@example.test', { role: 'viewer' });

    const adminRoutes = [
      'https://example.com/api/v1/admin/users',
      'https://example.com/api/v1/admin/content-types',
      'https://example.com/api/v1/admin/entries',
      'https://example.com/api/v1/admin/dashboard',
      'https://example.com/api/v1/admin/audit-log',
      'https://example.com/api/plugins/commerce/v1/products',
      'https://example.com/api/plugins/commerce/v1/customers',
    ];
    for (const url of adminRoutes) {
      const asNone = await SELF.fetch(url, { headers: { Cookie: none } });
      expect(asNone.status, url).toBe(403);
    }

    // The same routes are reachable for someone with a real (even the lowest) CMS role.
    expect((await SELF.fetch(adminRoutes[1]!, { headers: { Cookie: staff } })).status).toBe(200);
    // And no session at all is still a 401, not a 403.
    expect((await SELF.fetch(adminRoutes[0]!)).status).toBe(401);
  });

  it('privilege escalation is impossible: no client-supplied role is ever honored', async () => {
    // (a) at sign-up, for every CMS role including owner
    for (const role of ['owner', 'admin']) {
      const email = `escalate-${role}@example.test`;
      const response = await post('/sign-up/email', { email, password: PASSWORD, name: 'Eve', role });
      // Either rejected outright or the field is ignored — but never honored.
      expect(await roleOf(email)).not.toBe(role);
      if (response.status === 200) expect(await roleOf(email)).toBe('none');
    }

    // (b) after sign-in, via better-auth's own update-user
    const { customer, cookie } = await registerWebsiteUser('eve@example.test');
    // ...even alongside the other admin-granted flags
    await post('/update-user', { role: 'owner', developerToolsAccess: true, name: 'Eve' }, cookie);
    expect(await roleOf('eve@example.test')).toBe('none');
    const flags = await env.DB.prepare('SELECT developer_tools_access AS dev FROM user WHERE id = ?').bind(customer.id).first<{ dev: number }>();
    expect(flags?.dev).toBe(0);

    // (c) through the CMS role route: a website user, and an editor, can't grant anyone a role
    const editor = await signUpVerifiedAndGetCookie('escalate-editor@example.test', { role: 'editor' });
    const owner = await roleOf('escalate-editor@example.test');
    expect(owner).toBe('editor');
    for (const [who, actorCookie] of [
      ['website user', cookie],
      ['editor', editor],
    ] as const) {
      const promote = await SELF.fetch(`https://example.com/api/v1/admin/users/${customer.id}/role`, {
        method: 'PATCH',
        headers: { Cookie: actorCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(promote.status, who).toBe(403);
    }
    expect(await roleOf('eve@example.test')).toBe('none');
  });

  it('only an admin can grant CMS access to an existing website user, and can revoke it back to none', async () => {
    const adminCookie = await signUpVerifiedAndGetCookie('grant-admin@example.test', { role: 'admin' });
    const { customer, cookie } = await registerWebsiteUser('grantee@example.test');

    const grant = await SELF.fetch(`https://example.com/api/v1/admin/users/${customer.id}/role`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(grant.status).toBe(200);
    expect((await SELF.fetch('https://example.com/api/v1/admin/content-types', { headers: { Cookie: cookie } })).status).toBe(200);

    const revoke = await SELF.fetch(`https://example.com/api/v1/admin/users/${customer.id}/role`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'none' }),
    });
    expect(revoke.status).toBe(200);
    expect(await roleOf('grantee@example.test')).toBe('none');
    // Access is gone immediately (same session, role read fresh), but they're still a customer.
    expect((await SELF.fetch('https://example.com/api/v1/admin/content-types', { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await SELF.fetch(CUSTOMER, { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('website users never appear in the CMS users list', async () => {
    const adminCookie = await signUpVerifiedAndGetCookie('list-admin@example.test', { role: 'admin' });
    await registerWebsiteUser('a-customer@example.test');
    const list = await (await SELF.fetch('https://example.com/api/v1/admin/users', { headers: { Cookie: adminCookie } })).json<
      { email: string; role: string }[]
    >();
    expect(list.map((u) => u.email)).toEqual(['list-admin@example.test']);
  });

  it('login and logout go through core: sign-in yields a session Commerce accepts, sign-out ends it', async () => {
    await registerWebsiteUser('login@example.test');

    const signIn = await post('/sign-in/email', { email: 'LOGIN@example.test', password: PASSWORD });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0]!;
    expect((await SELF.fetch(CUSTOMER, { headers: { Cookie: cookie } })).status).toBe(200);

    const signOut = await SELF.fetch(`${AUTH}/sign-out`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: '{}',
    });
    expect(signOut.status).toBe(200);
    expect((await SELF.fetch(CUSTOMER, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('email verification: an unverified customer cannot sign in; the emailed link is for the website, not the admin app; verifying unlocks sign-in', async () => {
    const callbackURL = `${ALLOWED_ORIGIN}/account/verified`;
    const signUp = await post('/sign-up/email', { email: 'verify-me@example.test', password: PASSWORD, name: 'Verify Me', callbackURL });
    expect(signUp.status).toBe(200);

    const blocked = await withExpectedInternalRejection(() => post('/sign-in/email', { email: 'verify-me@example.test', password: PASSWORD }));
    expect(blocked.status).toBe(403);

    const messages = getTestEmails().filter((m) => m.to === 'verify-me@example.test' && m.html?.includes('verify-email'));
    // Every verification email for a website user (the sign-up one and the automatic re-send from
    // the blocked sign-in) is the website flavor.
    for (const each of messages) expect(each.html).not.toMatch(/localhost:5173\/verify-email/);
    const message = messages[0]!;
    // better-auth's own verification URL (API verify endpoint + the site's callbackURL), never the
    // admin SPA's /verify-email page that a CMS staff invitation points at.
    expect(message.html).toContain('/api/v1/auth/verify-email?token=');
    expect(message.html).toContain(encodeURIComponent(callbackURL));

    const token = extractVerificationToken('verify-me@example.test');
    // A verification with a callbackURL answers with a redirect, which better-auth throws as an
    // APIError (the same escaping-rejection quirk withExpectedInternalRejection documents).
    const verify = await withExpectedInternalRejection(() =>
      SELF.fetch(`${AUTH}/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`, {
        redirect: 'manual',
      }),
    );
    expect([200, 302]).toContain(verify.status);
    if (verify.status === 302) expect(verify.headers.get('location')).toContain('/account/verified');

    const signIn = await post('/sign-in/email', { email: 'verify-me@example.test', password: PASSWORD });
    expect(signIn.status).toBe(200);
  });
});
