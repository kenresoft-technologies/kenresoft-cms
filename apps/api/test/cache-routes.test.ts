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

describe('cache routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects purging the cache from an editor, purges only published entries as an owner', async () => {
    const ownerCookie = await authedCookie('cache-owner@pathvera.test');
    const editorCookie = await authedCookie('cache-editor@pathvera.test');
    const headers = { Cookie: ownerCookie, 'Content-Type': 'application/json' };

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
      body: JSON.stringify({ slug: 'published-one', status: 'published', data: {} }),
    });
    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'still-a-draft', status: 'draft', data: {} }),
    });

    const editorAttempt = await SELF.fetch('https://example.com/api/v1/admin/cache/purge', {
      method: 'POST',
      headers: { Cookie: editorCookie },
    });
    expect(editorAttempt.status).toBe(403);

    const response = await SELF.fetch('https://example.com/api/v1/admin/cache/purge', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entriesPurged: 1, mediaPurged: 0 });
  });
});
