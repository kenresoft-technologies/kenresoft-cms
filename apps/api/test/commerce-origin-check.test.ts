import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// The CORS allow-list this test config ships (apps/api/wrangler.test.toml's CORS_ORIGINS) —
// requireTrustedOriginForMutations (packages/plugin-ecommerce/src/lib/origin-check.ts) checks a
// mutating request's Origin header against exactly this list.
const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'https://attacker.example';

const CART_BASE = 'https://example.com/api/plugins/commerce/public/v1/cart';
const AUTH_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer-auth';

async function freshAdminCookie(): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'commerce-origin-admin@example.test', password: 'correct horse battery staple', name: 'Admin' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function createPublishedProduct(adminCookie: string) {
  const response = await SELF.fetch('https://example.com/api/plugins/commerce/v1/products', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Widget',
      slug: `widget-${crypto.randomUUID()}`,
      basePrice: 1000,
      currency: 'NGN',
      status: 'published',
    }),
  });
  return response.json<{ id: string }>();
}

describe('commerce plugin: Origin/CSRF check on cookie-authenticated mutations (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_cart_items');
    await env.DB.exec('DELETE FROM plugin_commerce_carts');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects a cart mutation whose Origin is present but not in the CORS allow-list', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);

    const res = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: DISALLOWED_ORIGIN },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    expect(res.status).toBe(403);

    const cartCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_carts').first<{ count: number }>();
    expect(cartCount?.count).toBe(0);
  });

  it('allows a cart mutation whose Origin matches the CORS allow-list', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);

    const res = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it('does not check Origin on a read (GET /cart)', async () => {
    const res = await SELF.fetch(CART_BASE, { headers: { Origin: DISALLOWED_ORIGIN } });
    expect(res.status).toBe(200);
  });

  it('rejects a body-less mutation (logout) from a disallowed Origin — the gap a CORS preflight alone would miss, since a body-less POST is a "simple" cross-origin request under the Fetch spec', async () => {
    const res = await SELF.fetch(`${AUTH_BASE}/logout`, {
      method: 'POST',
      headers: { Origin: DISALLOWED_ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it('allows a mutation with no Origin header at all (non-browser clients; this project’s own SELF.fetch test harness never sends one)', async () => {
    const res = await SELF.fetch(`${AUTH_BASE}/logout`, { method: 'POST' });
    expect(res.status).toBe(204);
  });
});
