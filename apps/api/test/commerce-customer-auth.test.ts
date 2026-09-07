import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Kept intentionally light on requests to /customer-auth/* — that whole sub-path shares ONE
// COMMERCE_CUSTOMER_AUTH_RATE_LIMITER bucket (10/60s per IP, docs/PLUGINS.md), and this bucket's
// state persists across every it() block within one test file (confirmed empirically, not
// assumed — a throwaway debug test hammering /register in a loop showed exactly 10 successes
// then 429s from the 11th call on, cumulative across the whole file's isolated runtime). Recovery/
// lifecycle scenarios live in commerce-customer-recovery.test.ts, and the rate limiter itself is
// exercised in its own dedicated file — the same separation auth-rate-limit.test.ts already uses
// relative to auth.test.ts.
const AUTH_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer-auth';
const CUSTOMER_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer';

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

describe('commerce plugin: customer auth (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
  });

  it('registers a customer with a session cookie, rejects a duplicate email, and logs in case-insensitively', async () => {
    const { response, cookie } = await register('Case-Test@Example.test');
    expect(response.status).toBe(201);
    expect(cookie).toBeDefined();
    const body = await response.json<{ email: string; name: string; emailVerified: boolean }>();
    expect(body).toMatchObject({ email: 'case-test@example.test', name: 'Test Customer', emailVerified: false });

    const duplicate = await SELF.fetch(`${AUTH_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Case-Test@Example.test', password: 'another password', name: 'Someone else' }),
    });
    expect(duplicate.status).toBe(409);

    const login = await SELF.fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'case-test@example.test', password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(200);
  });

  it('rejects wrong password and a nonexistent email with the identical generic message, accepts correct credentials', async () => {
    await register('login-test@example.test');

    const wrongPassword = await SELF.fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login-test@example.test', password: 'wrong password wrong' }),
    });
    const nonexistent = await SELF.fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'wrong password wrong' }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(nonexistent.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await nonexistent.json());

    const correct = await SELF.fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login-test@example.test', password: 'correct horse battery staple' }),
    });
    expect(correct.status).toBe(200);
  });

  it('logs out and revokes the session', async () => {
    const { cookie } = await register('logout-test@example.test');

    const meBefore = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: cookie! } });
    expect(meBefore.status).toBe(200);

    const logout = await SELF.fetch(`${AUTH_BASE}/logout`, { method: 'POST', headers: { Cookie: cookie! } });
    expect(logout.status).toBe(204);

    const meAfter = await SELF.fetch(CUSTOMER_BASE, { headers: { Cookie: cookie! } });
    expect(meAfter.status).toBe(401);
  });
});
