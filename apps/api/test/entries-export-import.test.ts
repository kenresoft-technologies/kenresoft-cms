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
  return authedCookie(`export-import-${cookieCounter}@pathvera.test`);
}

describe('entry export/import (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM webhook_deliveries');
    await env.DB.exec('DELETE FROM webhooks');
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('exports every entry for a content type as portable JSON', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'hello-world', status: 'published', data: { title: 'Hello' } }),
    });

    const exportRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/export?contentTypeId=${contentType.id}`,
      { headers: { Cookie: cookie } },
    );
    expect(exportRes.status).toBe(200);
    const body = await exportRes.json<{
      contentType: { name: string; slug: string };
      entries: Array<{ slug: string; status: string; data: unknown }>;
    }>();
    expect(body.contentType).toEqual({ name: 'Blog Post', slug: 'blog-post' });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ slug: 'hello-world', status: 'published', data: { title: 'Hello' } });
  });

  it('404s exporting a nonexistent content type', async () => {
    const cookie = await freshCookie();
    const response = await SELF.fetch('https://example.com/api/v1/admin/entries/export?contentTypeId=nope', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });

  it('imports entries — creating new ones and updating existing ones by slug', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'already-here', status: 'draft', data: { title: 'Old title' } }),
    });

    const importRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/import?contentTypeId=${contentType.id}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contentType: { name: 'Blog Post', slug: 'blog-post' },
          entries: [
            { slug: 'already-here', status: 'published', data: { title: 'New title' }, publishAt: null },
            { slug: 'brand-new', status: 'draft', data: { title: 'Fresh' }, publishAt: null },
          ],
        }),
      },
    );
    expect(importRes.status).toBe(200);
    expect(await importRes.json()).toEqual({ created: 1, updated: 1, errors: [] });

    const listRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`,
      { headers: { Cookie: cookie } },
    );
    const list = await listRes.json<Array<{ slug: string; status: string; data: { title: string } }>>();
    expect(list).toHaveLength(2);
    const updated = list.find((entry) => entry.slug === 'already-here');
    expect(updated).toMatchObject({ status: 'published', data: { title: 'New title' } });
  });

  it('rejects a file exported from a different content type', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/import?contentTypeId=${contentType.id}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contentType: { name: 'Product', slug: 'product' },
          entries: [{ slug: 'x', status: 'draft', data: {}, publishAt: null }],
        }),
      },
    );
    expect(response.status).toBe(400);
  });

  it('rejects import for a non-admin/editor role', async () => {
    const ownerCookie = await freshCookie();
    const ownerHeaders = { Cookie: ownerCookie, 'Content-Type': 'application/json' };
    const authorCookie = await freshCookie(); // defaults to editor on signup — demoted below

    const users = await (
      await SELF.fetch('https://example.com/api/v1/admin/users', { headers: ownerHeaders })
    ).json<Array<{ id: string; role: string }>>();
    const secondUser = users.find((u) => u.role !== 'owner');
    await SELF.fetch(`https://example.com/api/v1/admin/users/${secondUser!.id}/role`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ role: 'author' }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/admin/entries/import?contentTypeId=nope', {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    expect(response.status).toBe(403);
  });
});
