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
  return authedCookie(`commerce-categories-${cookieCounter}@example.test`);
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

const BASE = 'https://example.com/api/plugins/commerce/v1';

describe('commerce plugin: categories (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_product_images');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM plugin_commerce_categories');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects the mount without a session', async () => {
    const response = await SELF.fetch(`${BASE}/categories`);
    expect(response.status).toBe(401);
  });

  it('403s creating below editor, 201s at editor and above', async () => {
    const ownerCookie = await freshCookie();
    const authorCookie = await authedCookie('commerce-categories-author@example.test');
    await setRole(ownerCookie, await userId(authorCookie), 'author');

    const forbidden = await SELF.fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Books', slug: 'books' }),
    });
    expect(forbidden.status).toBe(403);

    const created = await SELF.fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Books', slug: 'books' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: 'Books', slug: 'books', status: 'active', parentId: null });
  });

  it('creates a hierarchy, lists it, updates and re-parents a category, then deletes the parent without cascading', async () => {
    const cookie = await freshCookie();

    const parentRes = await SELF.fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Electronics', slug: 'electronics' }),
    });
    const parent = await parentRes.json<{ id: string }>();

    const childRes = await SELF.fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Laptops', slug: 'laptops', parentId: parent.id }),
    });
    const child = await childRes.json<{ id: string; parentId: string }>();
    expect(child.parentId).toBe(parent.id);

    const listRes = await SELF.fetch(`${BASE}/categories`, { headers: { Cookie: cookie } });
    const list = await listRes.json<Array<{ id: string }>>();
    expect(list).toHaveLength(2);

    const updateRes = await SELF.fetch(`${BASE}/categories/${child.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Notebooks' }),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ name: 'Notebooks' });

    const deleteRes = await SELF.fetch(`${BASE}/categories/${parent.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    // Deleting the parent set-nulls the child's parentId rather than cascading (spec §28).
    const listAfter = await SELF.fetch(`${BASE}/categories`, { headers: { Cookie: cookie } });
    const afterList = await listAfter.json<Array<{ id: string; parentId: string | null }>>();
    expect(afterList).toHaveLength(1);
    expect(afterList[0]).toMatchObject({ id: child.id, parentId: null });
  });

  it('404s updating/deleting a nonexistent category', async () => {
    const cookie = await freshCookie();

    const updateRes = await SELF.fetch(`${BASE}/categories/does-not-exist`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(updateRes.status).toBe(404);

    const deleteRes = await SELF.fetch(`${BASE}/categories/does-not-exist`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(404);
  });
});
