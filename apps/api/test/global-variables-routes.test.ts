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

describe('global variables routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM global_variables');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('walks the admin flow: create -> edit -> delete, rejects creation/deletion from an editor', async () => {
    const ownerCookie = await authedCookie('gv-owner@pathvera.test');
    const editorCookie = await authedCookie('gv-editor@pathvera.test');
    const ownerHeaders = { Cookie: ownerCookie, 'Content-Type': 'application/json' };

    const editorCreateAttempt = await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'phone_number', value: '555-0100' }),
    });
    expect(editorCreateAttempt.status).toBe(403);

    const createRes = await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ key: 'phone_number', value: '555-0100' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ id: string; key: string; value: string }>();
    expect(created).toMatchObject({ key: 'phone_number', value: '555-0100' });

    const dupeRes = await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ key: 'phone_number', value: 'anything' }),
    });
    expect(dupeRes.status).toBe(400);

    // Editing the value is not owner-gated — an editor can do it.
    const editRes = await SELF.fetch(`https://example.com/api/v1/admin/global-variables/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '555-0199' }),
    });
    expect(editRes.status).toBe(200);
    expect(await editRes.json()).toMatchObject({ key: 'phone_number', value: '555-0199' });

    const listRes = await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      headers: { Cookie: ownerCookie },
    });
    expect(await listRes.json()).toHaveLength(1);

    const editorDeleteAttempt = await SELF.fetch(
      `https://example.com/api/v1/admin/global-variables/${created.id}`,
      { method: 'DELETE', headers: { Cookie: editorCookie } },
    );
    expect(editorDeleteAttempt.status).toBe(403);

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/global-variables/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    expect(deleteRes.status).toBe(204);
  });

  it('rejects an invalid key format', async () => {
    const ownerCookie = await authedCookie('gv-invalid-owner@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'not a valid key!', value: 'x' }),
    });
    expect(response.status).toBe(400);
  });

  it('serves every variable as a flat key/value map on the public, unauthenticated route', async () => {
    const ownerCookie = await authedCookie('gv-public-owner@pathvera.test');
    const headers = { Cookie: ownerCookie, 'Content-Type': 'application/json' };

    await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: 'phone_number', value: '555-0100' }),
    });
    await SELF.fetch('https://example.com/api/v1/admin/global-variables', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: 'office_address', value: '1 Example St' }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/public/global-variables');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ phone_number: '555-0100', office_address: '1 Example St' });
  });
});
