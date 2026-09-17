import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

describe('GET /admin/content-types/with-counts (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('returns fieldCount/entryCount per content type in one pass, zero for a type with neither', async () => {
    const cookie = await authedCookie('ct-counts@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const withData = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'With data', slug: 'with-data' }),
      })
    ).json<{ id: string }>();
    const empty = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Empty', slug: 'empty-ct' }),
      })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/content-types/${withData.id}/fields`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text', required: true }),
    });
    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${withData.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'post-1', data: {} }),
    });
    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${withData.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'post-2', data: {} }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types/with-counts', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const rows = await response.json<Array<{ id: string; fieldCount: number; entryCount: number }>>();

    const withDataRow = rows.find((r) => r.id === withData.id);
    const emptyRow = rows.find((r) => r.id === empty.id);
    expect(withDataRow).toMatchObject({ fieldCount: 1, entryCount: 2 });
    expect(emptyRow).toMatchObject({ fieldCount: 0, entryCount: 0 });
  });
});
