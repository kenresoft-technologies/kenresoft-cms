import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestEmails } from '../src/lib/email';
import { extractVerificationToken, registerWebsiteUser, signUpVerifiedAndGetCookie } from './helpers/auth';

const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1/customers';
const CUSTOMER_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
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
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('requires an admin role: editor is forbidden, the owner is allowed', async () => {
    const ownerCookie = await authedCookie('commerce-admin-customers-owner@example.test'); // claims owner
    const editorCookie = await authedCookie('commerce-admin-customers-editor@example.test');
    await setRole(ownerCookie, await userId(editorCookie), 'editor');

    const forbidden = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: editorCookie } });
    expect(forbidden.status).toBe(403);

    const allowed = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: ownerCookie } });
    expect(allowed.status).toBe(200);
  });

  it('a website user (a customer) cannot use the admin customer routes at all', async () => {
    const { cookie } = await registerWebsiteUser('sneaky-customer@example.test');
    const response = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: cookie } });
    expect(response.status).toBe(403);
  });

  it('lists only website users (never CMS staff), searches by email/name, and shows a detail view with addresses', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-1@example.test');
    const adminId = await userId(adminCookie);
    const alice = await registerWebsiteUser('alice@example.test', { name: 'Alice Anderson' });
    await registerWebsiteUser('bob@example.test', { name: 'Bob Brown' });

    const listRes = await SELF.fetch(ADMIN_BASE, { headers: { Cookie: adminCookie } });
    const list = await listRes.json<Array<{ email: string }>>();
    // The signed-in owner is a CMS staff account, not a customer, and is never listed as one.
    expect(list.map((c) => c.email).sort()).toEqual(['alice@example.test', 'bob@example.test']);

    const searchRes = await SELF.fetch(`${ADMIN_BASE}?search=alice`, { headers: { Cookie: adminCookie } });
    const search = await searchRes.json<Array<{ email: string }>>();
    expect(search).toHaveLength(1);
    expect(search[0]!.email).toBe('alice@example.test');

    const detailRes = await SELF.fetch(`${ADMIN_BASE}/${alice.customer.id}`, { headers: { Cookie: adminCookie } });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json<{ email: string; addresses: unknown[] }>();
    expect(detail).toMatchObject({ email: 'alice@example.test', addresses: [] });

    // A staff account (here the owner) can't be addressed through the customer routes at all.
    expect((await SELF.fetch(`${ADMIN_BASE}/${adminId}`, { headers: { Cookie: adminCookie } })).status).toBe(404);
    const disableStaff = await SELF.fetch(`${ADMIN_BASE}/${adminId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disableStaff.status).toBe(404);
  });

  it('404s a nonexistent customer id', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-2@example.test');
    const response = await SELF.fetch(`${ADMIN_BASE}/does-not-exist`, { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(404);
  });

  it('disabling a customer revokes their sessions; re-enabling does not restore them', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-3@example.test');
    const { customer, cookie: customerCookie } = await registerWebsiteUser('disable-target@example.test', { name: 'Target' });

    const meBefore = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: customerCookie } });
    expect(meBefore.status).toBe(200);

    const disableRes = await SELF.fetch(`${ADMIN_BASE}/${customer.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disableRes.status).toBe(200);
    expect(await disableRes.json()).toMatchObject({ disabled: true });

    const meAfter = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: customerCookie } });
    expect(meAfter.status).toBe(401);

    const enableRes = await SELF.fetch(`${ADMIN_BASE}/${customer.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: false }),
    });
    expect(await enableRes.json()).toMatchObject({ disabled: false });

    // The old (revoked) session is gone for good; re-enabling doesn't resurrect it.
    const meAfterReEnable = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: customerCookie } });
    expect(meAfterReEnable.status).toBe(401);
  });

  it('staff can resend the shared verification email for an unverified customer; a no-op for one already verified', async () => {
    const adminCookie = await authedCookie('commerce-admin-customers-4@example.test');
    const unverified = await registerWebsiteUser('unverified@example.test', { name: 'Unverified', verified: false });
    const verified = await registerWebsiteUser('verified@example.test', { name: 'Verified' });

    const before = getTestEmails().filter((m) => m.to === 'unverified@example.test').length;
    const resendUnverified = await SELF.fetch(`${ADMIN_BASE}/${unverified.customer.id}/resend-verification-email`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(resendUnverified.status).toBe(200);
    expect(await resendUnverified.json()).toMatchObject({ message: 'Verification email sent.' });
    expect(getTestEmails().filter((m) => m.to === 'unverified@example.test').length).toBeGreaterThan(before);

    // Core's own verification link works: consuming its token verifies the account.
    const token = extractVerificationToken('unverified@example.test');
    const verify = await SELF.fetch(`https://example.com/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(verify.status).toBe(200);

    const resendVerified = await SELF.fetch(`${ADMIN_BASE}/${verified.customer.id}/resend-verification-email`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(resendVerified.status).toBe(200);
    expect(await resendVerified.json()).toMatchObject({ message: "This customer's email is already verified, nothing sent." });

    const resendMissing = await SELF.fetch(`${ADMIN_BASE}/does-not-exist/resend-verification-email`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(resendMissing.status).toBe(404);
  });
});
