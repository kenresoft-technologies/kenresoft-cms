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

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
    headers: { Cookie: cookie },
  });
  const body = await response.json<{ user: { id: string } }>();
  return body.user.id;
}

describe('users routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('lists users for any authenticated user', async () => {
    const ownerCookie = await authedCookie('users-owner@pathvera.test');
    await authedCookie('users-editor@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/users', {
      headers: { Cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const users = await response.json<{ email: string; role: string }[]>();
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.email).sort()).toEqual(['users-editor@pathvera.test', 'users-owner@pathvera.test']);
  });

  it('rejects role changes from an editor, allows them from an owner', async () => {
    const ownerCookie = await authedCookie('role-owner@pathvera.test');
    const editorCookie = await authedCookie('role-editor@pathvera.test');
    const editorId = await userId(editorCookie);

    const editorAttempt = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}/role`, {
      method: 'PATCH',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(editorAttempt.status).toBe(403);

    const ownerAttempt = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}/role`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(ownerAttempt.status).toBe(200);
    expect(await ownerAttempt.json()).toMatchObject({ role: 'owner' });
  });

  it('404s when changing the role of a nonexistent user', async () => {
    const ownerCookie = await authedCookie('role-missing-owner@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/users/does-not-exist/role', {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(response.status).toBe(404);
  });

  it('rejects demoting the last remaining owner', async () => {
    const ownerCookie = await authedCookie('sole-owner@pathvera.test');
    const ownerId = await userId(ownerCookie);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}/role`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(response.status).toBe(400);

    const stillOwner = await SELF.fetch('https://example.com/api/v1/admin/users', {
      headers: { Cookie: ownerCookie },
    });
    const [user] = await stillOwner.json<{ role: string }[]>();
    expect(user?.role).toBe('owner');
  });

  it('allows demoting an owner when a second owner remains', async () => {
    const firstOwnerCookie = await authedCookie('first-owner@pathvera.test');
    const secondOwnerCookie = await authedCookie('second-owner@pathvera.test');
    const secondOwnerId = await userId(secondOwnerCookie);

    await SELF.fetch(`https://example.com/api/v1/admin/users/${secondOwnerId}/role`, {
      method: 'PATCH',
      headers: { Cookie: firstOwnerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${secondOwnerId}/role`, {
      method: 'PATCH',
      headers: { Cookie: firstOwnerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: 'editor' });
  });

  it('rejects every users route without a session', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/admin/users');
    expect(response.status).toBe(401);
  });
});
