import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/lib/secret-store';
import { signUpVerifiedAndGetCookie } from './helpers/auth';

const BASE = 'https://example.com/api/v1/admin/integrations';

describe('integration keys entered from the CMS (real D1)', () => {
  it('stores the Pixabay key encrypted, never returns it, and is admin-only', async () => {
    // Isolated storage resets D1 between tests, so the whole flow runs in one test body.
    const adminCookie = await signUpVerifiedAndGetCookie('integrations-admin@example.test', {
      password: 'correct horse battery staple',
      name: 'Admin',
    });
    const admin = { Cookie: adminCookie, 'Content-Type': 'application/json' };

    const initial = await (await SELF.fetch(BASE, { headers: admin })).json();
    expect(initial).toEqual({ pixabay: { configured: false, source: null } });

    const secret = 'pixabay-key-1234567890';
    const put = await SELF.fetch(`${BASE}/pixabay`, { method: 'PUT', headers: admin, body: JSON.stringify({ apiKey: secret }) });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(secret);
    expect(JSON.parse(putText)).toEqual({ pixabay: { configured: true, source: 'admin' } });

    const after = await (await SELF.fetch(BASE, { headers: admin })).text();
    expect(after).not.toContain(secret);

    // At rest it's ciphertext, and only this deployment's own secret decrypts it.
    const row = await env.DB.prepare('SELECT ciphertext FROM integration_secrets WHERE key = ?').bind('pixabay').first<{ ciphertext: string }>();
    expect(row!.ciphertext).not.toContain(secret);
    expect(await decryptSecret(env.BETTER_AUTH_SECRET, row!.ciphertext)).toBe(secret);
    expect(await decryptSecret('some-other-secret-value', row!.ciphertext)).toBeNull();

    // Too-short keys are rejected.
    expect((await SELF.fetch(`${BASE}/pixabay`, { method: 'PUT', headers: admin, body: JSON.stringify({ apiKey: 'x' }) })).status).toBe(400);

    // Editors can't touch it.
    const editorCookie = await signUpVerifiedAndGetCookie('integrations-editor@example.test', {
      password: 'correct horse battery staple',
      name: 'Editor',
    });
    const editor = { Cookie: editorCookie, 'Content-Type': 'application/json' };
    expect((await SELF.fetch(BASE, { headers: editor })).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/pixabay`, { method: 'PUT', headers: editor, body: JSON.stringify({ apiKey: secret }) })).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/pixabay`, { method: 'DELETE', headers: editor })).status).toBe(403);

    const del = await SELF.fetch(`${BASE}/pixabay`, { method: 'DELETE', headers: admin });
    expect(await del.json()).toEqual({ pixabay: { configured: false, source: null } });
  });

  it('round-trips encryption and rejects tampered ciphertext', async () => {
    const stored = await encryptSecret('secret-a', 'hello');
    expect(await decryptSecret('secret-a', stored)).toBe('hello');
    expect(await decryptSecret('secret-a', stored.slice(0, -2) + 'AA')).toBeNull();
    expect(await decryptSecret('secret-a', 'garbage')).toBeNull();
  });
});
