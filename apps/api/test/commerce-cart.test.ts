import { createDb } from '@kenresoft-cms/database';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomer } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1';
const CART_BASE = 'https://example.com/api/plugins/commerce/public/v1/cart';

function extractGuestCartCookie(response: Response): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = setCookie.split(',').find((part) => part.trim().startsWith('commerce_guest_cart='));
  return match?.trim().split(';')[0];
}

async function freshAdminCookie(): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `commerce-cart-admin@example.test`, password: 'correct horse battery staple', name: 'Admin' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function createPublishedProduct(adminCookie: string, overrides: Record<string, unknown> = {}) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Widget',
      slug: `widget-${crypto.randomUUID()}`,
      basePrice: 1000,
      currency: 'NGN',
      status: 'published',
      ...overrides,
    }),
  });
  return response.json<{ id: string; currency: string }>();
}

async function createVariant(adminCookie: string, productId: string, overrides: Record<string, unknown> = {}) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products/${productId}/variants`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Small', stockQty: 2, ...overrides }),
  });
  return response.json<{ id: string; stockQty: number }>();
}

async function registeredCustomer(email: string) {
  const db = createDb(env.DB);
  const customer = await createCustomer(db, { email, name: 'Test Customer', password: 'correct horse battery staple' });
  const rawToken = await createCustomerSession(db, customer.id);
  return { customer, cookie: `commerce_customer_session=${rawToken}` };
}

describe('commerce plugin: cart (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_cart_items');
    await env.DB.exec('DELETE FROM plugin_commerce_carts');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_product_images');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('GET /cart is side-effect-free: no cart is created just by reading', async () => {
    const before = await SELF.fetch(CART_BASE);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ id: null, currency: null, items: [] });
    expect(extractGuestCartCookie(before)).toBeUndefined();

    const cartCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_carts').first<{ count: number }>();
    expect(cartCount?.count).toBe(0);
  });

  it('a guest cart is created on first add-to-cart, and the cookie identifies it thereafter', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);

    const addRes = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: 2 }),
    });
    expect(addRes.status).toBe(200);
    const guestCookie = extractGuestCartCookie(addRes);
    expect(guestCookie).toBeDefined();

    const body = await addRes.json<{ items: Array<{ quantity: number; unitPrice: number }> }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ quantity: 2, unitPrice: 1000 });

    const getRes = await SELF.fetch(CART_BASE, { headers: { Cookie: guestCookie! } });
    const getBody = await getRes.json<{ items: unknown[] }>();
    expect(getBody.items).toHaveLength(1);
  });

  it('adding the same product again increments quantity rather than duplicating a row', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);

    const first = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    const guestCookie = extractGuestCartCookie(first);

    const second = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: guestCookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    const body = await second.json<{ items: Array<{ quantity: number }> }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.quantity).toBe(2);
  });

  it('rejects adding a draft product, and rejects a currency mismatch against the cart', async () => {
    const adminCookie = await freshAdminCookie();
    const draft = await createPublishedProduct(adminCookie, { status: 'draft' });

    const draftAdd = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: draft.id, quantity: 1 }),
    });
    expect(draftAdd.status).toBe(400);

    const ngnProduct = await createPublishedProduct(adminCookie, { currency: 'NGN' });
    const first = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: ngnProduct.id, quantity: 1 }),
    });
    const guestCookie = extractGuestCartCookie(first);

    const usdProduct = await createPublishedProduct(adminCookie, { currency: 'USD' });
    const mismatch = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: guestCookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: usdProduct.id, quantity: 1 }),
    });
    expect(mismatch.status).toBe(400);
  });

  it('caps quantity at a tracked variant’s stock, but not for a variant-less product', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 2 });

    const overAdd = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 5 }),
    });
    const overBody = await overAdd.json<{ items: Array<{ quantity: number }> }>();
    expect(overBody.items[0]!.quantity).toBe(2);
    const guestCookie = extractGuestCartCookie(overAdd);

    // A second, variant-less product on the same cart has no stock concept — no cap applied.
    const bare = await createPublishedProduct(adminCookie);
    const bareAdd = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: guestCookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: bare.id, quantity: 50 }),
    });
    const bareBody = await bareAdd.json<{ items: Array<{ productId: string; quantity: number }> }>();
    expect(bareBody.items.find((item) => item.productId === bare.id)?.quantity).toBe(50);
  });

  it('updates and removes an item, and 404s an item id from a different cart', async () => {
    const adminCookie = await freshAdminCookie();
    const productA = await createPublishedProduct(adminCookie);
    const productB = await createPublishedProduct(adminCookie);

    const addA = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: productA.id, quantity: 1 }),
    });
    const cookieA = extractGuestCartCookie(addA);
    const bodyA = await addA.json<{ items: Array<{ id: string }> }>();
    const itemAId = bodyA.items[0]!.id;

    const addB = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: productB.id, quantity: 1 }),
    });
    const cookieB = extractGuestCartCookie(addB);

    // Cart B's cookie cannot touch cart A's item.
    const crossUpdate = await SELF.fetch(`${CART_BASE}/items/${itemAId}`, {
      method: 'PATCH',
      headers: { Cookie: cookieB!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 3 }),
    });
    expect(crossUpdate.status).toBe(404);

    const update = await SELF.fetch(`${CART_BASE}/items/${itemAId}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 3 }),
    });
    expect(update.status).toBe(200);

    const remove = await SELF.fetch(`${CART_BASE}/items/${itemAId}`, { method: 'DELETE', headers: { Cookie: cookieA! } });
    const removeBody = await remove.json<{ items: unknown[] }>();
    expect(removeBody.items).toHaveLength(0);
  });

  it('DELETE /cart clears the whole cart', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);

    const add = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    const cookie = extractGuestCartCookie(add);

    const clear = await SELF.fetch(CART_BASE, { method: 'DELETE', headers: { Cookie: cookie! } });
    expect(clear.status).toBe(204);

    const after = await SELF.fetch(CART_BASE, { headers: { Cookie: cookie! } });
    expect(await after.json()).toEqual({ id: null, currency: null, items: [] });
  });

  it('logging in merges a guest cart into the customer’s own cart, summing and capping quantities atomically', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 3 });

    // Guest adds 2 of the tracked variant.
    const guestAdd = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 2 }),
    });
    const guestCookie = extractGuestCartCookie(guestAdd)!;
    const guestCartId = guestCookie.split('=')[1]!;

    // The customer already has 2 of the same variant in their own cart from a previous session.
    const { cookie: customerCookie } = await registeredCustomer('cart-merge@example.test');
    const preLogin = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: customerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 2 }),
    });
    expect(preLogin.status).toBe(200);

    // Log in as that customer while presenting the guest cart cookie too — merge should fire.
    const login = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer-auth/login', {
      method: 'POST',
      headers: { Cookie: `${guestCookie}; ${customerCookie}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cart-merge@example.test', password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(200);

    const merged = await SELF.fetch(CART_BASE, { headers: { Cookie: customerCookie } });
    const mergedBody = await merged.json<{ items: Array<{ quantity: number }> }>();
    // 2 (guest) + 2 (customer's own) = 4, capped at stockQty=3.
    expect(mergedBody.items).toHaveLength(1);
    expect(mergedBody.items[0]!.quantity).toBe(3);

    // The guest cart itself is gone.
    const guestGone = await env.DB.prepare('SELECT id FROM plugin_commerce_carts WHERE id = ?').bind(guestCartId).first();
    expect(guestGone).toBeNull();
  });

  it('rejects adding an out-of-stock (stockQty 0) variant, rather than adding a quantity-0 line', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 0 });

    const res = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 1 }),
    });
    expect(res.status).toBe(400);

    const itemCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_cart_items').first<{ count: number }>();
    expect(itemCount?.count).toBe(0);
  });

  it('rejects adding an archived variant', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { status: 'archived' });

    const res = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('a forged guest-cart cookie naming another customer’s real cart cannot hijack it on login', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);

    // Victim: a genuine customer with their own real (non-guest) cart holding an item.
    const { cookie: victimCookie } = await registeredCustomer('cart-hijack-victim@example.test');
    const victimAdd = await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: victimCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    const victimCart = await victimAdd.json<{ id: string }>();

    // A second customer logs in while presenting the victim's own cart id as their OWN
    // "guest cart" cookie — forged/guessed, never actually issued to them by this deployment.
    // Without mergeGuestCartIntoCustomerCart independently re-verifying customerId IS NULL, this
    // would delete the victim's real cart and move its item onto the attacker's own cart.
    const { cookie: attackerCookie } = await registeredCustomer('cart-hijack-attacker@example.test');
    const login = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/customer-auth/login', {
      method: 'POST',
      headers: { Cookie: `commerce_guest_cart=${victimCart.id}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cart-hijack-attacker@example.test', password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(200);

    // The victim's cart is untouched: still exists, still has its own item.
    const victimAfter = await SELF.fetch(CART_BASE, { headers: { Cookie: victimCookie } });
    const victimAfterBody = await victimAfter.json<{ id: string | null; items: unknown[] }>();
    expect(victimAfterBody.id).toBe(victimCart.id);
    expect(victimAfterBody.items).toHaveLength(1);

    // The attacker's own cart gained nothing from the victim's.
    const attackerAfter = await SELF.fetch(CART_BASE, { headers: { Cookie: attackerCookie } });
    const attackerAfterBody = await attackerAfter.json<{ items: unknown[] }>();
    expect(attackerAfterBody.items).toHaveLength(0);
  });
});
