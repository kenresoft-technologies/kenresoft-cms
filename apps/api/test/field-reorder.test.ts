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

describe('field reordering (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('reorders fields to match the given fieldIds order', async () => {
    const cookie = await authedCookie('reorder@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const fieldA = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'a', label: 'A', fieldType: 'text' }),
      })
    ).json<{ id: string }>();
    const fieldB = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'b', label: 'B', fieldType: 'text' }),
      })
    ).json<{ id: string }>();
    const fieldC = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'c', label: 'C', fieldType: 'text' }),
      })
    ).json<{ id: string }>();

    const reorderRes = await SELF.fetch(
      `https://example.com/api/v1/admin/content-types/${contentType.id}/fields/reorder`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fieldIds: [fieldC.id, fieldA.id, fieldB.id] }),
      },
    );
    expect(reorderRes.status).toBe(200);
    const reordered = await reorderRes.json<{ id: string; name: string; sortOrder: number }[]>();
    expect(reordered.map((f) => f.name)).toEqual(['c', 'a', 'b']);
    expect(reordered.map((f) => f.sortOrder)).toEqual([0, 1, 2]);

    const listRes = await SELF.fetch(
      `https://example.com/api/v1/admin/content-types/${contentType.id}/fields`,
      { headers: { Cookie: cookie } },
    );
    const listed = await listRes.json<{ name: string }[]>();
    expect(listed.map((f) => f.name)).toEqual(['c', 'a', 'b']);
  });

  it('rejects a reorder whose fieldIds do not exactly match the existing fields', async () => {
    const cookie = await authedCookie('reorder-mismatch@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'a', label: 'A', fieldType: 'text' }),
    });

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/content-types/${contentType.id}/fields/reorder`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fieldIds: ['does-not-exist'] }),
      },
    );
    expect(response.status).toBe(400);
  });

  it('404s reordering fields for a non-existent content type', async () => {
    const cookie = await authedCookie('reorder-404@example.test');

    const response = await SELF.fetch(
      'https://example.com/api/v1/admin/content-types/does-not-exist/fields/reorder',
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldIds: ['x'] }),
      },
    );
    expect(response.status).toBe(404);
  });
});
