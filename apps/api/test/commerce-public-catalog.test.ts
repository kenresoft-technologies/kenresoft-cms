import { createDb } from '@kenresoft-cms/database';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { setPluginEnabled } from '../src/repositories/plugin-enablement';

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
  return authedCookie(`commerce-public-${cookieCounter}@example.test`);
}

// A byte-valid PNG header (signature + IHDR) — matches test/media-routes.test.ts's own helper,
// enough for the admin media route's sniffImage validation and metadata extraction.
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1';
const PUBLIC_BASE = 'https://example.com/api/plugins/commerce/public/v1';

async function createCategory(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const response = await SELF.fetch(`${ADMIN_BASE}/categories`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Gadgets', slug: 'gadgets', ...overrides }),
  });
  return response.json();
}

async function createProduct(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const response = await SELF.fetch(`${ADMIN_BASE}/products`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Widget', slug: 'widget', basePrice: 1000, currency: 'NGN', ...overrides }),
  });
  return response.json();
}

describe('commerce plugin: public catalog (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_product_images');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM plugin_commerce_categories');
    await env.DB.exec('DELETE FROM plugin_enablement');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('serves categories and products with no session at all', async () => {
    const cookie = await freshCookie();
    await createProduct(cookie, { slug: 'published-widget', status: 'published' });
    await createCategory(cookie);

    const categoriesRes = await SELF.fetch(`${PUBLIC_BASE}/categories`);
    expect(categoriesRes.status).toBe(200);
    expect(await categoriesRes.json()).toHaveLength(1);

    const productsRes = await SELF.fetch(`${PUBLIC_BASE}/products`);
    expect(productsRes.status).toBe(200);
    expect(await productsRes.json()).toMatchObject([{ slug: 'published-widget' }]);
  });

  it('only lists active categories and published products', async () => {
    const cookie = await freshCookie();
    await createCategory(cookie, { slug: 'active-category', status: 'active' });
    await createCategory(cookie, { slug: 'archived-category', status: 'archived' });
    await createProduct(cookie, { slug: 'draft-widget', status: 'draft' });
    await createProduct(cookie, { slug: 'published-widget', status: 'published' });

    const categories = await (await SELF.fetch(`${PUBLIC_BASE}/categories`)).json<Array<{ slug: string }>>();
    expect(categories.map((c) => c.slug)).toEqual(['active-category']);

    const products = await (await SELF.fetch(`${PUBLIC_BASE}/products`)).json<Array<{ slug: string }>>();
    expect(products.map((p) => p.slug)).toEqual(['published-widget']);
  });

  it('filters public product listing by categoryId', async () => {
    const cookie = await freshCookie();
    const category = await createCategory(cookie);
    await createProduct(cookie, { slug: 'in-category', status: 'published', categoryId: category.id });
    await createProduct(cookie, { slug: 'no-category', status: 'published' });

    const products = await (await SELF.fetch(`${PUBLIC_BASE}/products?categoryId=${category.id}`)).json<
      Array<{ slug: string }>
    >();
    expect(products.map((p) => p.slug)).toEqual(['in-category']);
  });

  it('serves a published product by slug and 404s a draft exactly like a nonexistent slug', async () => {
    const cookie = await freshCookie();
    await createProduct(cookie, { slug: 'published-widget', status: 'published' });
    await createProduct(cookie, { slug: 'draft-widget', status: 'draft' });

    const publishedRes = await SELF.fetch(`${PUBLIC_BASE}/products/published-widget`);
    expect(publishedRes.status).toBe(200);
    expect(await publishedRes.json()).toMatchObject({ slug: 'published-widget' });

    const draftRes = await SELF.fetch(`${PUBLIC_BASE}/products/draft-widget`);
    const nonexistentRes = await SELF.fetch(`${PUBLIC_BASE}/products/does-not-exist`);
    expect(draftRes.status).toBe(404);
    expect(nonexistentRes.status).toBe(404);
    expect(await draftRes.json()).toEqual(await nonexistentRes.json());
  });

  it('a product detail response includes its active variants and images, but not archived variants', async () => {
    const cookie = await freshCookie();
    const product = await createProduct(cookie, { slug: 'widget-with-options', status: 'published' });

    const activeVariant = await (
      await SELF.fetch(`${ADMIN_BASE}/products/${product.id}/variants`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Small', price: 900, stockQty: 5, attributes: { size: 'S' } }),
      })
    ).json<{ id: string }>();
    await SELF.fetch(`${ADMIN_BASE}/products/${product.id}/variants`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Discontinued', stockQty: 0, status: 'archived' }),
    });

    const form = new FormData();
    form.set('file', new File([pngBytes(256, 128)], 'photo.png', { type: 'image/png' }));
    const media = await (
      await SELF.fetch('https://example.com/api/v1/admin/media', { method: 'POST', headers: { Cookie: cookie }, body: form })
    ).json<{ id: string }>();
    await SELF.fetch(`${ADMIN_BASE}/products/${product.id}/images`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: media.id, altText: 'Front view' }),
    });

    const detail = await (await SELF.fetch(`${PUBLIC_BASE}/products/widget-with-options`)).json<{
      variants: Array<{ name: string; price: number | null; stockQty: number }>;
      images: Array<{ mediaId: string; altText: string | null }>;
    }>();
    expect(detail.variants).toEqual([{ id: activeVariant.id, name: 'Small', sku: null, price: 900, compareAtPrice: null, stockQty: 5, attributes: { size: 'S' } }]);
    expect(detail.images).toEqual([{ id: expect.any(String), mediaId: media.id, altText: 'Front view', sortOrder: 0 }]);

    // The list endpoint deliberately stays lean — no images/variants per row.
    const list = await (await SELF.fetch(`${PUBLIC_BASE}/products`)).json<Array<Record<string, unknown>>>();
    expect(list[0]).not.toHaveProperty('variants');
    expect(list[0]).not.toHaveProperty('images');
  });

  it('404s the entire public mount once the plugin is disabled, and restores on re-enable', async () => {
    const cookie = await freshCookie();
    await createProduct(cookie, { slug: 'published-widget', status: 'published' });
    const db = createDb(env.DB);

    const beforeDisable = await SELF.fetch(`${PUBLIC_BASE}/products`);
    expect(beforeDisable.status).toBe(200);

    await setPluginEnabled(db, 'commerce', false);
    const disabled = await SELF.fetch(`${PUBLIC_BASE}/products`);
    expect(disabled.status).toBe(404);

    // The admin mount is gated by the same live check, not just the public one.
    const disabledAdmin = await SELF.fetch(`${ADMIN_BASE}/products`, { headers: { Cookie: cookie } });
    expect(disabledAdmin.status).toBe(404);

    await setPluginEnabled(db, 'commerce', true);
    const reenabled = await SELF.fetch(`${PUBLIC_BASE}/products`);
    expect(reenabled.status).toBe(200);
  });
});
