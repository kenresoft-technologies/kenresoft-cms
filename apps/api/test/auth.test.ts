import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

const db = createDb(env.DB);

async function signUp(email: string, extra: Record<string, unknown> = {}) {
  return SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User', ...extra }),
  });
}

describe('better-auth wiring (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('bootstraps the first signup as owner', async () => {
    const response = await signUp('first@example.test');
    expect(response.status).toBe(200);

    const user = await db.query.user.findFirst();
    expect(user).toMatchObject({ email: 'first@example.test', role: 'owner' });
  });

  it('defaults subsequent signups to editor', async () => {
    await signUp('first@example.test');
    const response = await signUp('editor@example.test');
    expect(response.status).toBe(200);

    const editor = await db.query.user.findFirst({
      where: (user, { eq }) => eq(user.email, 'editor@example.test'),
    });
    expect(editor?.role).toBe('editor');
  });

  it('ignores a client-supplied role at signup (input: false)', async () => {
    await signUp('first@example.test');
    const response = await signUp('attacker@example.test', { role: 'admin' });
    expect(response.status).toBe(200);

    const attacker = await db.query.user.findFirst({
      where: (user, { eq }) => eq(user.email, 'attacker@example.test'),
    });
    expect(attacker?.role).toBe('editor');
  });

  it('signs in and receives a session cookie', async () => {
    await signUp('login@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login@example.test', password: 'correct horse battery staple' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
  });
});
