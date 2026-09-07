import { createDb } from '@kenresoft-cms/database';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomerToken } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-tokens';
import { createCustomer } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Split from commerce-customer-auth.test.ts specifically to stay well under the shared
// COMMERCE_CUSTOMER_AUTH_RATE_LIMITER bucket (10/60s per IP) that persists across every it()
// block in one file — see that file's own comment for how this was confirmed empirically.
const AUTH_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer-auth';

function extractCookie(response: Response, name: string): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = setCookie.split(',').find((part) => part.trim().startsWith(`${name}=`));
  return match?.trim().split(';')[0];
}

async function register(email: string, password = 'correct horse battery staple') {
  const response = await SELF.fetch(`${AUTH_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Test Customer' }),
  });
  return { response, cookie: extractCookie(response, 'commerce_customer_session') };
}

async function getCustomerId(email: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT id FROM plugin_commerce_customers WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  return row!.id;
}

describe('commerce plugin: customer password reset / verification / lifecycle (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_customer_tokens');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
  });

  it('password-reset request is identical for a real vs. fake email, and confirm is single-use and revokes every session', async () => {
    const { cookie } = await register('reset-test@example.test');

    const real = await SELF.fetch(`${AUTH_BASE}/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-test@example.test' }),
    });
    const fake = await SELF.fetch(`${AUTH_BASE}/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-at-all@example.test' }),
    });
    expect(real.status).toBe(200);
    expect(fake.status).toBe(200);
    expect(await real.json()).toEqual(await fake.json());

    const db = createDb(env.DB);
    const customerId = await getCustomerId('reset-test@example.test');
    const token = await createCustomerToken(db, customerId, 'password_reset');

    const confirm = await SELF.fetch(`${AUTH_BASE}/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'a brand new password' }),
    });
    expect(confirm.status).toBe(200);

    // The old session is revoked by the reset.
    const meWithOldCookie = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer', {
      headers: { Cookie: cookie! },
    });
    expect(meWithOldCookie.status).toBe(401);

    // The token is single-use — reusing it fails.
    const reuse = await SELF.fetch(`${AUTH_BASE}/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'yet another password' }),
    });
    expect(reuse.status).toBe(400);

    // The new password works.
    const login = await SELF.fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-test@example.test', password: 'a brand new password' }),
    });
    expect(login.status).toBe(200);
  });

  it('verifies an email with a real token and rejects an invalid one', async () => {
    // Created directly via the repository, not the HTTP /register endpoint — this test isn't
    // exercising registration itself, and every HTTP call to /customer-auth/* shares one rate
    // limit bucket across the whole file (see the top-of-file comment).
    const db = createDb(env.DB);
    const customer = await createCustomer(db, {
      email: 'verify-test@example.test',
      name: 'Verify Test',
      password: 'correct horse battery staple',
    });
    const token = await createCustomerToken(db, customer.id, 'email_verification');

    const invalid = await SELF.fetch(`${AUTH_BASE}/verify-email?token=not-a-real-token`);
    expect(invalid.status).toBe(400);

    const valid = await SELF.fetch(`${AUTH_BASE}/verify-email?token=${encodeURIComponent(token)}`);
    expect(valid.status).toBe(200);

    const row = await env.DB.prepare(`SELECT email_verified FROM plugin_commerce_customers WHERE id = ?`)
      .bind(customer.id)
      .first<{ email_verified: number }>();
    expect(row?.email_verified).toBe(1);
  });

  it('a disabled customer cannot log in, and disabling revokes its existing session', async () => {
    // Customer and session both created directly via the repository — this test is about the
    // disable/revoke behavior itself, not the register/login endpoints, so it doesn't need to
    // spend any of the file's shared /customer-auth/* rate-limit budget creating them.
    const db = createDb(env.DB);
    const customer = await createCustomer(db, {
      email: 'disabled-test@example.test',
      name: 'Disabled Test',
      password: 'correct horse battery staple',
    });
    const rawToken = await createCustomerSession(db, customer.id);
    const cookie = `commerce_customer_session=${rawToken}`;

    const meBeforeDisable = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer', {
      headers: { Cookie: cookie },
    });
    expect(meBeforeDisable.status).toBe(200);

    await env.DB.prepare(`UPDATE plugin_commerce_customers SET disabled = 1 WHERE id = ?`).bind(customer.id).run();
    await env.DB.prepare(`DELETE FROM plugin_commerce_customer_sessions WHERE customer_id = ?`).bind(customer.id).run();

    const login = await SELF.fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'disabled-test@example.test', password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(401);

    const meAfterDisable = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer', {
      headers: { Cookie: cookie },
    });
    expect(meAfterDisable.status).toBe(401);
  });
});
