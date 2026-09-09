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

async function createGlobalVariable(cookie: string, key: string, value: string) {
  await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

describe('legacy global variable -> structured settings migration (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM structured_settings');
    await env.DB.exec('DELETE FROM global_variables');
    await env.DB.exec('DELETE FROM audit_log');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('imports only known legacy keys, leaving unknown keys untouched', async () => {
    const cookie = await authedCookie('legacy-owner@example.test');
    await createGlobalVariable(cookie, 'site_name', 'Kenresoft');
    await createGlobalVariable(cookie, 'tagline', 'Building great things');
    await createGlobalVariable(cookie, 'contact_email', 'hello@kenresoft.test');
    await createGlobalVariable(cookie, 'social_github', 'https://github.com/kenresoft');
    await createGlobalVariable(cookie, 'social_madeupplatform', 'https://example.com/kenresoft');
    await createGlobalVariable(cookie, 'footer_copyright', '© 2026 Kenresoft');
    await createGlobalVariable(cookie, 'some_unrelated_key', 'left alone');

    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/migrate-legacy', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const report = await response.json<{ migratedModules: string[]; skippedModules: string[] }>();
    expect(report.migratedModules.sort()).toEqual(['contact', 'footer', 'general', 'social']);

    const general = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/general', { headers: { Cookie: cookie } })
    ).json<{ data: { siteName: string; tagline: string } }>();
    expect(general.data).toMatchObject({ siteName: 'Kenresoft', tagline: 'Building great things' });

    const social = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/social', { headers: { Cookie: cookie } })
    ).json<{ data: { links: { platform: string }[] } }>();
    expect(social.data.links).toHaveLength(2);
    expect(social.data.links.map((l) => l.platform).sort()).toEqual(['custom', 'github']);

    // The unrelated key is still there, completely untouched.
    const variables = await (
      await SELF.fetch('https://example.com/api/v1/admin/global-variables', { headers: { Cookie: cookie } })
    ).json<{ key: string }[]>();
    expect(variables.some((v) => v.key === 'some_unrelated_key')).toBe(true);
  });

  it('is idempotent: a second run skips already-populated modules and never overwrites a manual edit', async () => {
    const cookie = await authedCookie('legacy-idempotent@example.test');
    await createGlobalVariable(cookie, 'contact_email', 'hello@kenresoft.test');

    await SELF.fetch('https://example.com/api/v1/admin/structured-settings/migrate-legacy', {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    // Manually override what the migration wrote.
    await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'manually-edited@kenresoft.test', phone: null, address: null }),
    });

    const second = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/migrate-legacy', {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json<{ migratedModules: string[]; skippedModules: string[] }>();
    expect(second.migratedModules).toEqual([]);
    expect(second.skippedModules).toEqual(['contact']);

    const contact = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', { headers: { Cookie: cookie } })
    ).json<{ data: { email: string } }>();
    expect(contact.data.email).toBe('manually-edited@kenresoft.test');
  });

  it('skips a malformed legacy URL rather than failing the whole run', async () => {
    const cookie = await authedCookie('legacy-malformed@example.test');
    await createGlobalVariable(cookie, 'social_github', 'not a valid url');

    const response = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/migrate-legacy', {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json<{ migratedModules: string[]; skippedKeys: { key: string; reason: string }[] }>();

    expect(response.migratedModules).not.toContain('social');
    expect(response.skippedKeys.some((entry) => entry.key === 'social_github')).toBe(true);
  });

  it('is admin-only', async () => {
    const ownerCookie = await authedCookie('legacy-role-owner@example.test');
    const editorCookie = await authedCookie('legacy-role-editor@example.test');
    void ownerCookie;

    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/migrate-legacy', {
      method: 'POST',
      headers: { Cookie: editorCookie },
    });
    expect(response.status).toBe(403);
  });
});
