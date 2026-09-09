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

describe('structured settings admin routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM structured_settings');
    await env.DB.exec('DELETE FROM audit_log');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('returns null before a module has ever been saved', async () => {
    const cookie = await authedCookie('ss-empty@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it('rejects a write from an editor, allows it from an owner (the first signup)', async () => {
    const ownerCookie = await authedCookie('ss-owner@example.test');
    const editorCookie = await authedCookie('ss-editor@example.test');

    const editorRes = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', {
      method: 'PUT',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hello@example.com', phone: null, address: null }),
    });
    expect(editorRes.status).toBe(403);

    const ownerRes = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', {
      method: 'PUT',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hello@example.com', phone: null, address: null }),
    });
    expect(ownerRes.status).toBe(200);
    expect(await ownerRes.json()).toMatchObject({ module: 'contact', data: { email: 'hello@example.com' } });
  });

  it('rejects a body that fails the module schema (400, not a crash)', async () => {
    const cookie = await authedCookie('ss-invalid@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/contact', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', phone: null, address: null }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects an unsupported module name in the URL', async () => {
    const cookie = await authedCookie('ss-bad-module@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/not-a-module', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(400);
  });

  it('upserts a single row per module: a second PUT updates it, not a new one', async () => {
    const cookie = await authedCookie('ss-upsert@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const first = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/social', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ links: [{ platform: 'github', label: 'GitHub', url: 'https://github.com/example' }] }),
      })
    ).json<{ id: string }>();

    const second = await (
      await SELF.fetch('https://example.com/api/v1/admin/structured-settings/social', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ links: [] }),
      })
    ).json<{ id: string; data: { links: unknown[] } }>();

    expect(second.id).toBe(first.id);
    expect(second.data.links).toHaveLength(0);

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM structured_settings WHERE module = 'social'",
    ).first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it('records an audit-log entry for a structured settings write', async () => {
    const cookie = await authedCookie('ss-audit@example.test');

    await SELF.fetch('https://example.com/api/v1/admin/structured-settings/seo', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultTitle: 'Kenresoft',
        defaultDescription: null,
        defaultOgImageMediaId: null,
        googleSiteVerification: null,
      }),
    });

    const row = await env.DB.prepare(
      "SELECT action, target_id FROM audit_log WHERE action = 'structured_settings.updated'",
    ).first<{ action: string; target_id: string }>();
    expect(row).toMatchObject({ action: 'structured_settings.updated', target_id: 'seo' });
  });

  it('rejects every structured settings route without a session', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/general');
    expect(response.status).toBe(401);
  });
});
