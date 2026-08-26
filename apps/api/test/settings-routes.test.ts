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

describe('settings routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM settings');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('returns null before any settings have been saved', async () => {
    const cookie = await authedCookie('settings-empty@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/settings', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it('rejects settings writes from an editor, allows them from an owner', async () => {
    const ownerCookie = await authedCookie('settings-owner@pathvera.test');
    const editorCookie = await authedCookie('settings-editor@pathvera.test');

    const editorRes = await SELF.fetch('https://example.com/api/v1/admin/settings', {
      method: 'PUT',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pathvera Group' }),
    });
    expect(editorRes.status).toBe(403);

    const ownerRes = await SELF.fetch('https://example.com/api/v1/admin/settings', {
      method: 'PUT',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pathvera Group' }),
    });
    expect(ownerRes.status).toBe(200);
    expect(await ownerRes.json()).toMatchObject({ name: 'Pathvera Group' });
  });

  it('upserts a single row: a second PUT updates the same settings row, not a new one', async () => {
    const cookie = await authedCookie('settings-upsert@pathvera.test');

    const first = await (
      await SELF.fetch('https://example.com/api/v1/admin/settings', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Pathvera Group',
          contactEmail: 'hello@pathvera.test',
          socialLinks: { twitter: 'https://x.com/pathvera' },
          featureFlags: { newsletter: true },
        }),
      })
    ).json<{ id: string }>();

    const second = await (
      await SELF.fetch('https://example.com/api/v1/admin/settings', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Pathvera Group Updated' }),
      })
    ).json<{ id: string; name: string }>();

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Pathvera Group Updated');

    const rows = await env.DB.prepare('SELECT COUNT(*) as count FROM settings').first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it('validates the request body before writing', async () => {
    const cookie = await authedCookie('settings-invalid@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/settings', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', contactEmail: 'not-an-email' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects every settings route without a session', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/admin/settings');
    expect(response.status).toBe(401);
  });
});
