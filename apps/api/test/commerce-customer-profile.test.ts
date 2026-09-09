import { createDb } from '@kenresoft-cms/database';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomer } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Customers/sessions are created directly via the repository, not the HTTP /customer-auth/*
// endpoints — this file is about /customer/* (profile/password/addresses), which isn't
// rate-limited the same way, and staying off the shared customer-auth budget avoids any
// interaction with commerce-customer-auth.test.ts's own note about that bucket.
const CUSTOMER_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer';

async function registeredCustomer(email: string, password = 'correct horse battery staple') {
  const db = createDb(env.DB);
  const customer = await createCustomer(db, { email, name: 'Test Customer', password });
  const rawToken = await createCustomerSession(db, customer.id);
  return { customer, cookie: `commerce_customer_session=${rawToken}` };
}

describe('commerce plugin: customer profile/password/addresses (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_customer_addresses');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
  });

  it('rejects every route without a session', async () => {
    const responses = await Promise.all([
      SELF.fetch(CUSTOMER_BASE),
      SELF.fetch(CUSTOMER_BASE, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      SELF.fetch(`${CUSTOMER_BASE}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      SELF.fetch(`${CUSTOMER_BASE}/addresses`),
      SELF.fetch(`${CUSTOMER_BASE}/addresses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it('gets and updates the signed-in customer’s own profile', async () => {
    const { cookie } = await registeredCustomer('profile-test@example.test');

    const getRes = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: cookie } });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ email: 'profile-test@example.test', name: 'Test Customer' });

    const patchRes = await SELF.fetch(CUSTOMER_BASE, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name', phone: '+1-555-0100' }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ name: 'Updated Name', phone: '+1-555-0100' });
  });

  it('changes the password, rejects a wrong current password, and revokes other sessions', async () => {
    const { customer, cookie } = await registeredCustomer('password-test@example.test');
    const db = createDb(env.DB);
    const otherRawToken = await createCustomerSession(db, customer.id);
    const otherCookie = `commerce_customer_session=${otherRawToken}`;

    const wrongCurrent = await SELF.fetch(`${CUSTOMER_BASE}/password`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'not the real password', newPassword: 'a whole new password' }),
    });
    expect(wrongCurrent.status).toBe(400);

    const change = await SELF.fetch(`${CUSTOMER_BASE}/password`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'correct horse battery staple', newPassword: 'a whole new password' }),
    });
    expect(change.status).toBe(200);

    // The "other" session (a different browser/device) is revoked by the password change.
    const otherMe = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: otherCookie } });
    expect(otherMe.status).toBe(401);

    // This request's own session cookie was replaced with a fresh one in the response, not left
    // dangling — the caller isn't logged out by their own password change.
    const setCookieHeader = change.headers.get('set-cookie');
    expect(setCookieHeader).toContain('commerce_customer_session=');
  });

  it('manages addresses: create, list, update, delete, and default-address exclusivity', async () => {
    const { cookie } = await registeredCustomer('address-test@example.test');
    const baseAddress = {
      recipientName: 'Jane Doe',
      line1: '123 Main St',
      city: 'Lagos',
      postalCode: '100001',
      country: 'NG',
    };

    const createFirst = await SELF.fetch(`${CUSTOMER_BASE}/addresses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseAddress, label: 'Home', isDefault: true }),
    });
    expect(createFirst.status).toBe(201);
    const first = await createFirst.json<{ id: string; isDefault: boolean }>();
    expect(first.isDefault).toBe(true);

    const createSecond = await SELF.fetch(`${CUSTOMER_BASE}/addresses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseAddress, label: 'Work', isDefault: true }),
    });
    const second = await createSecond.json<{ id: string; isDefault: boolean }>();
    expect(second.isDefault).toBe(true);

    // Setting the second address default un-defaults the first.
    const listRes = await SELF.fetch(`${CUSTOMER_BASE}/addresses`, { headers: { Cookie: cookie } });
    const list = await listRes.json<Array<{ id: string; isDefault: boolean }>>();
    expect(list.find((a) => a.id === first.id)?.isDefault).toBe(false);
    expect(list.find((a) => a.id === second.id)?.isDefault).toBe(true);

    const updateRes = await SELF.fetch(`${CUSTOMER_BASE}/addresses/${first.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientName: 'Jane Q. Doe' }),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ recipientName: 'Jane Q. Doe' });

    const deleteRes = await SELF.fetch(`${CUSTOMER_BASE}/addresses/${first.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const deleteMissing = await SELF.fetch(`${CUSTOMER_BASE}/addresses/${first.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteMissing.status).toBe(404);
  });

  it('404s an address that belongs to a different customer', async () => {
    const owner = await registeredCustomer('address-owner@example.test');
    const intruder = await registeredCustomer('address-intruder@example.test');

    const created = await SELF.fetch(`${CUSTOMER_BASE}/addresses`, {
      method: 'POST',
      headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Owner',
        line1: '1 Owner St',
        city: 'Lagos',
        postalCode: '100001',
        country: 'NG',
      }),
    });
    const address = await created.json<{ id: string }>();

    const intruderUpdate = await SELF.fetch(`${CUSTOMER_BASE}/addresses/${address.id}`, {
      method: 'PATCH',
      headers: { Cookie: intruder.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientName: 'Hijacked' }),
    });
    expect(intruderUpdate.status).toBe(404);
  });
});
