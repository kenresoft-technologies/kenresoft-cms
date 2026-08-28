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
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(editorAttempt.status).toBe(403);

    const ownerAttempt = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}/role`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(ownerAttempt.status).toBe(200);
    expect(await ownerAttempt.json()).toMatchObject({ role: 'admin' });
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

  // The first-ever signup is the literal 'owner' role (src/lib/auth.ts's bootstrap hook) —
  // role changes targeting an owner are rejected outright by checkNotTargetingOwner (403),
  // before the "would this leave zero guardians" check ever runs. Ownership only ever moves
  // through Transfer ownership (apps/api/src/routes/admin/security.ts), never this route.
  it('rejects changing the owner\'s own role — even by themselves', async () => {
    const ownerCookie = await authedCookie('sole-owner@pathvera.test');
    const ownerId = await userId(ownerCookie);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}/role`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(response.status).toBe(403);

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
      body: JSON.stringify({ role: 'admin' }),
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

  it('creates a user with a temporary password (owner only), who can then sign in with it', async () => {
    const ownerCookie = await authedCookie('create-owner@pathvera.test');
    const editorCookie = await authedCookie('create-editor@pathvera.test');

    const editorAttempt = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Fail', email: 'should-fail@pathvera.test' }),
    });
    expect(editorAttempt.status).toBe(403);

    const response = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Editor', email: 'new-editor@pathvera.test' }),
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ user: { email: string; role: string }; temporaryPassword: string }>();
    expect(body.user).toMatchObject({ email: 'new-editor@pathvera.test', role: 'editor' });
    expect(body.temporaryPassword.length).toBeGreaterThan(16);

    const signInRes = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new-editor@pathvera.test', password: body.temporaryPassword }),
    });
    expect(signInRes.status).toBe(200);
  });

  it('rejects creating a user with an email that already exists', async () => {
    const ownerCookie = await authedCookie('dupe-owner@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dupe', email: 'dupe-owner@pathvera.test' }),
    });
    expect(response.status).toBe(400);
  });

  it('deletes a user (owner only), rejects deleting yourself or the owner', async () => {
    const ownerCookie = await authedCookie('delete-owner@pathvera.test');
    const editorCookie = await authedCookie('delete-editor@pathvera.test');
    const editorId = await userId(editorCookie);
    const ownerId = await userId(ownerCookie);

    const editorAttempt = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}`, {
      method: 'DELETE',
      headers: { Cookie: editorCookie },
    });
    expect(editorAttempt.status).toBe(403);

    // The owner is immune to deletion (checkNotTargetingOwner) — that check runs before the
    // self-delete check even gets a chance to apply, so this is a 403, not the 400 a
    // non-owner self-delete would normally get.
    const selfDelete = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    expect(selfDelete.status).toBe(403);

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    expect(deleteRes.status).toBe(204);

    const listRes = await SELF.fetch('https://example.com/api/v1/admin/users', {
      headers: { Cookie: ownerCookie },
    });
    const users = await listRes.json<{ email: string }[]>();
    expect(users.map((u) => u.email)).toEqual(['delete-owner@pathvera.test']);
  });

  it('404s deleting a nonexistent user', async () => {
    const ownerCookie = await authedCookie('delete-missing-owner@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/users/does-not-exist', {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    expect(response.status).toBe(404);
  });
});
