import { createDb } from '@kenresoft-cms/database';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomerToken } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-tokens';
import { createCustomer, markCustomerEmailVerified } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1/customers';

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: cookie } });
  const body = await response.json<{ user: { id: string } }>();
  return body.user.id;
}

async function setRole(adminCookie: string, targetId: string, role: string): Promise<void> {
  await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

describe('commerce plugin: admin customers (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_customer_addresses');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('requires an admin role — editor is forbidden, admin (the first signup) is allowed', async () => {
    const ownerCookie = await authedCookie('commerce-admin-customers-owner@example.test'); // claims owner
    const editorCookie = await authedCookie('commerce-admin-customers-editor@example.test');
    await setRole(ownerCookie, await userId(editorCookie), 'editor');

    const forbidden = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: editorCookie } });
    expect(forbidden.status).toBe(403);

    const allowed = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: ownerCookie } });
    expect(allowed.status).toBe(200);
  });

  it('lists customers and searches by email/name, gets a detail view with addresses', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-1@example.test');
    const db = createDb(env.DB);
    await createCustomer(db, { email: 'alice@example.test', name: 'Alice Anderson', password: 'correct horse battery staple' });
    await createCustomer(db, { email: 'bob@example.test', name: 'Bob Brown', password: 'correct horse battery staple' });

    const listRes = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: adminCookie } });
    const list = await listRes.json<Array<{ email: string }>>();
    expect(list.map((c) => c.email).sort()).toEqual(['alice@example.test', 'bob@example.test']);

    const searchRes = await SELF.fetch(`${ADMIN_BASE}?search=alice`, { headers: { Cookie: adminCookie } });
    const search = await searchRes.json<Array<{ email: string }>>();
    expect(search).toHaveLength(1);
    expect(search[0]!.email).toBe('alice@example.test');

    const alice = await db.query.pluginCommerceCustomers.findFirst({
      where: (customers, { eq }) => eq(customers.email, 'alice@example.test'),
    });
    const detailRes = await SELF.fetch(`${ADMIN_BASE}/${alice!.id}`, { headers: { Cookie: adminCookie } });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json<{ email: string; addresses: unknown[] }>();
    expect(detail).toMatchObject({ email: 'alice@example.test', addresses: [] });
  });

  it('404s a nonexistent customer id', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-2@example.test');
    const response = await SELF.fetch(`${ADMIN_BASE}/does-not-exist`, { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(404);
  });

  it('disabling a customer revokes their sessions; re-enabling does not restore them', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-3@example.test');
    const db = createDb(env.DB);
    const customer = await createCustomer(db, {
      email: 'disable-target@example.test',
      name: 'Target',
      password: 'correct horse battery staple',
    });
    const rawToken = await createCustomerSession(db, customer.id);
    const customerCookie = `commerce_customer_session=${rawToken}`;

    const meBefore = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer', {
      headers: { Cookie: customerCookie },
    });
    expect(meBefore.status).toBe(200);

    const disableRes = await SELF.fetch(`${ADMIN_BASE}/${customer.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disableRes.status).toBe(200);
    expect(await disableRes.json()).toMatchObject({ disabled: true });

    const meAfter = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer', {
      headers: { Cookie: customerCookie },
    });
    expect(meAfter.status).toBe(401);

    const enableRes = await SELF.fetch(`${ADMIN_BASE}/${customer.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: false }),
    });
    expect(await enableRes.json()).toMatchObject({ disabled: false });

    // The old (revoked) session is gone for good — re-enabling doesn't resurrect it.
    const meAfterReEnable = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer', {
      headers: { Cookie: customerCookie },
    });
    expect(meAfterReEnable.status).toBe(401);
  });

  it('staff can resend a verification email for an unverified customer, and it is a no-op for one already verified', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-4@example.test');
    const db = createDb(env.DB);
    const unverified = await createCustomer(db, { email: 'unverified@example.test', name: 'Unverified', password: 'correct horse battery staple' });
    const verified = await createCustomer(db, { email: 'verified@example.test', name: 'Verified', password: 'correct horse battery staple' });
    await markCustomerEmailVerified(db, verified.id);
    const staleToken = await createCustomerToken(db, unverified.id, 'email_verification');

    const resendUnverified = await SELF.fetch(`${ADMIN_BASE}/${unverified.id}/resend-verification-email`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(resendUnverified.status).toBe(200);
    expect(await resendUnverified.json()).toMatchObject({ message: 'Verification email sent.' });

    // The prior token was superseded by the fresh one the resend just issued.
    const staleAttempt = await SELF.fetch(
      `https://example.com/api/plugins/commerce/public/v1/customer-auth/verify-email?token=${encodeURIComponent(staleToken)}`,
    );
    expect(staleAttempt.status).toBe(400);

    const resendVerified = await SELF.fetch(`${ADMIN_BASE}/${verified.id}/resend-verification-email`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(resendVerified.status).toBe(200);
    expect(await resendVerified.json()).toMatchObject({ message: "This customer's email is already verified — nothing sent." });

    const resendMissing = await SELF.fetch(`${ADMIN_BASE}/does-not-exist/resend-verification-email`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(resendMissing.status).toBe(404);
  });
});
