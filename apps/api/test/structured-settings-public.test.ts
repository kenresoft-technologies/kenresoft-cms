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

describe('structured settings public route (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM structured_settings');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('returns {} for a module that has never been saved, unauthenticated', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/public/settings/footer');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('serves the saved module data structured, unauthenticated', async () => {
    const cookie = await authedCookie('ss-public-owner@example.test');

    await SELF.fetch('https://example.com/api/v1/admin/structured-settings/social', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        links: [{ platform: 'github', label: 'GitHub', url: 'https://github.com/example' }],
      }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/public/settings/social');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      links: [{ platform: 'github', label: 'GitHub', url: 'https://github.com/example' }],
    });
  });

  it('never leaks a module write into a different module', async () => {
    const cookie = await authedCookie('ss-public-isolation@example.test');

    await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hello@example.com', phone: null, address: null }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/public/settings/general');
    expect(await response.json()).toEqual({});
  });
});
