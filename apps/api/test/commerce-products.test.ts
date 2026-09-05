import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

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

let cookieCounter = 0;
async function freshCookie(): Promise<string> {
  cookieCounter += 1;
  return authedCookie(`commerce-products-${cookieCounter}@example.test`);
}

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
    headers: { Cookie: cookie },
  });
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

// A byte-valid PNG header (signature + IHDR) — enough for the media upload route's sniffImage
// validation, matching media-routes.test.ts's own helper exactly.
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

async function uploadMedia(cookie: string): Promise<string> {
  const form = new FormData();
  form.set('file', new File([pngBytes(64, 64)], 'photo.png', { type: 'image/png' }));
  const response = await SELF.fetch('https://example.com/api/v1/admin/media', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  const media = await response.json<{ id: string }>();
  return media.id;
}

const BASE = 'https://example.com/api/plugins/commerce/v1';

async function createProduct(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const response = await SELF.fetch(`${BASE}/products`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Widget', slug: 'widget', basePrice: 1000, currency: 'NGN', ...overrides }),
  });
  return response.json();
}

describe('commerce plugin: products (real D1 + R2)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_product_images');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM plugin_commerce_categories');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('403s creating below editor, 201s at editor and above', async () => {
    const ownerCookie = await freshCookie();
    const authorCookie = await authedCookie('commerce-products-author@example.test');
    await setRole(ownerCookie, await userId(authorCookie), 'author');

    const forbidden = await SELF.fetch(`${BASE}/products`, {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget', slug: 'widget', basePrice: 1000, currency: 'NGN' }),
    });
    expect(forbidden.status).toBe(403);

    const created = await createProduct(ownerCookie);
    expect(created).toMatchObject({ name: 'Widget', slug: 'widget', basePrice: 1000, currency: 'NGN', status: 'draft' });
  });

  it('400s creating/updating with a categoryId that does not exist', async () => {
    const cookie = await freshCookie();

    const badCreate = await SELF.fetch(`${BASE}/products`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget', slug: 'widget', basePrice: 1000, currency: 'NGN', categoryId: 'nope' }),
    });
    expect(badCreate.status).toBe(400);

    const product = await createProduct(cookie);
    const badUpdate = await SELF.fetch(`${BASE}/products/${product.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: 'nope' }),
    });
    expect(badUpdate.status).toBe(400);
  });

  it('gets a product with its variants and images, updates it, and deletes it', async () => {
    const cookie = await freshCookie();
    const product = await createProduct(cookie);

    const getRes = await SELF.fetch(`${BASE}/products/${product.id}`, { headers: { Cookie: cookie } });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: product.id, variants: [], images: [] });

    const updateRes = await SELF.fetch(`${BASE}/products/${product.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published', basePrice: 2000 }),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ status: 'published', basePrice: 2000 });

    const deleteRes = await SELF.fetch(`${BASE}/products/${product.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(deleteRes.status).toBe(204);

    const getAfter = await SELF.fetch(`${BASE}/products/${product.id}`, { headers: { Cookie: cookie } });
    expect(getAfter.status).toBe(404);
  });

  it('filters listing by status and category', async () => {
    const cookie = await freshCookie();
    const categoryRes = await SELF.fetch('https://example.com/api/plugins/commerce/v1/categories', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gadgets', slug: 'gadgets' }),
    });
    const category = await categoryRes.json<{ id: string }>();

    await createProduct(cookie, { slug: 'draft-widget', status: 'draft' });
    await createProduct(cookie, { slug: 'published-widget', status: 'published', categoryId: category.id });

    const byStatus = await SELF.fetch(`${BASE}/products?status=published`, { headers: { Cookie: cookie } });
    expect((await byStatus.json<Array<{ slug: string }>>()).map((p) => p.slug)).toEqual(['published-widget']);

    const byCategory = await SELF.fetch(`${BASE}/products?categoryId=${category.id}`, { headers: { Cookie: cookie } });
    expect((await byCategory.json<Array<{ slug: string }>>()).map((p) => p.slug)).toEqual(['published-widget']);
  });

  it('adds, updates, and deletes a variant, 404ing a variant id that belongs to a different product', async () => {
    const cookie = await freshCookie();
    const productA = await createProduct(cookie, { slug: 'product-a' });
    const productB = await createProduct(cookie, { slug: 'product-b' });

    const createRes = await SELF.fetch(`${BASE}/products/${productA.id}/variants`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Small', stockQty: 5 }),
    });
    expect(createRes.status).toBe(201);
    const variant = await createRes.json<{ id: string }>();

    const crossProductUpdate = await SELF.fetch(`${BASE}/products/${productB.id}/variants/${variant.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(crossProductUpdate.status).toBe(404);

    const updateRes = await SELF.fetch(`${BASE}/products/${productA.id}/variants/${variant.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockQty: 10 }),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ stockQty: 10 });

    const deleteRes = await SELF.fetch(`${BASE}/products/${productA.id}/variants/${variant.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);
  });

  it('associates and removes an existing media item as a product image, 400ing an unknown mediaId', async () => {
    const cookie = await freshCookie();
    const product = await createProduct(cookie);
    const mediaId = await uploadMedia(cookie);

    const badImage = await SELF.fetch(`${BASE}/products/${product.id}/images`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: 'does-not-exist' }),
    });
    expect(badImage.status).toBe(400);

    const createRes = await SELF.fetch(`${BASE}/products/${product.id}/images`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId }),
    });
    expect(createRes.status).toBe(201);
    const image = await createRes.json<{ id: string; mediaId: string }>();
    expect(image.mediaId).toBe(mediaId);

    const getRes = await SELF.fetch(`${BASE}/products/${product.id}`, { headers: { Cookie: cookie } });
    expect(await getRes.json()).toMatchObject({ images: [{ id: image.id, mediaId }] });

    const deleteRes = await SELF.fetch(`${BASE}/products/${product.id}/images/${image.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);
  });
});
