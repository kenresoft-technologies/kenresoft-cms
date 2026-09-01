import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const PASSWORD = 'correct horse battery staple';

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Test User' }),
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

async function setRole(actorCookie: string, targetId: string, role: string) {
  return SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { Cookie: actorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

async function elevate(cookie: string, password = PASSWORD) {
  return SELF.fetch('https://example.com/api/v1/admin/security/elevate', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

describe('owner protection (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('an admin cannot demote the owner', async () => {
    const ownerCookie = await authedCookie('op-owner-1@pathvera.test');
    const adminCookie = await authedCookie('op-admin-1@pathvera.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');

    const response = await setRole(adminCookie, ownerId, 'editor');
    expect(response.status).toBe(403);

    const list = await (
      await SELF.fetch('https://example.com/api/v1/admin/users', { headers: { Cookie: ownerCookie } })
    ).json<{ id: string; role: string }[]>();
    expect(list.find((u) => u.id === ownerId)?.role).toBe('owner');
  });

  it('an admin cannot delete the owner', async () => {
    const ownerCookie = await authedCookie('op-owner-2@pathvera.test');
    const adminCookie = await authedCookie('op-admin-2@pathvera.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(403);
  });

  it('an admin cannot disable the owner, even with a fresh elevation', async () => {
    const ownerCookie = await authedCookie('op-owner-3@pathvera.test');
    const adminCookie = await authedCookie('op-admin-3@pathvera.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');
    expect((await elevate(adminCookie)).status).toBe(200);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}/disabled`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(response.status).toBe(403);
  });

  it('owner can create an admin, and can later remove them', async () => {
    const ownerCookie = await authedCookie('op-owner-4@pathvera.test');
    const created = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Admin', email: 'op-new-admin-4@pathvera.test' }),
    });
    expect(created.status).toBe(201);
    const { user } = await created.json<{ user: { id: string } }>();
    expect((await setRole(ownerCookie, user.id, 'admin')).status).toBe(200);

    const deleted = await SELF.fetch(`https://example.com/api/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    expect(deleted.status).toBe(204);
  });

  it('disabling an admin requires a fresh elevation, not just an admin session', async () => {
    const ownerCookie = await authedCookie('op-owner-5@pathvera.test');
    const targetCookie = await authedCookie('op-target-5@pathvera.test');
    const actorCookie = await authedCookie('op-actor-5@pathvera.test');
    const targetId = await userId(targetCookie);
    await setRole(ownerCookie, targetId, 'admin');
    await setRole(ownerCookie, await userId(actorCookie), 'admin');

    const withoutElevation = await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/disabled`, {
      method: 'PATCH',
      headers: { Cookie: actorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(withoutElevation.status).toBe(403);

    expect((await elevate(actorCookie)).status).toBe(200);
    const withElevation = await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/disabled`, {
      method: 'PATCH',
      headers: { Cookie: actorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(withElevation.status).toBe(200);
    expect(await withElevation.json()).toMatchObject({ disabled: true });
  });

  it('disabling a non-admin (editor/author/viewer) needs no elevation', async () => {
    const ownerCookie = await authedCookie('op-owner-6@pathvera.test');
    const editorCookie = await authedCookie('op-editor-6@pathvera.test');
    const editorId = await userId(editorCookie);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}/disabled`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(response.status).toBe(200);
  });

  // "Wrong password -> 403, nothing granted" is covered at the route level by
  // test/security-elevate.test.ts (a mocked-better-auth unit test) rather than here — calling
  // better-auth's api.verifyPassword() with a deliberately wrong password through a real,
  // full-D1 request triggers an unrelated unhandled-rejection quirk inside better-auth/
  // better-call's internals (reproduced identically on Linux CI, not just locally) that fails
  // the whole test file regardless of this assertion's own outcome. The "never elevated -> 403"
  // half of what this test checked is already covered above by "disabling an admin requires a
  // fresh elevation, not just an admin session".

  // Not reachable through normal signup/transfer (the owner role is always immune to removal
  // via the API, so a deployment can never organically reach zero owners) — this simulates the
  // defense-in-depth scenario directly by removing the owner row at the DB layer, the way an
  // operator running raw SQL by hand might. checkGuardianRemains should still catch it.
  it('refuses to leave the deployment with no owner or admin, even in a contrived zero-owner state', async () => {
    const ownerCookie = await authedCookie('op-owner-8@pathvera.test');
    const adminCookie = await authedCookie('op-admin-8@pathvera.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');
    await env.DB.exec(`DELETE FROM session WHERE user_id = '${ownerId}'`);
    await env.DB.exec(`DELETE FROM account WHERE user_id = '${ownerId}'`);
    await env.DB.exec(`DELETE FROM user WHERE id = '${ownerId}'`);

    const response = await setRole(adminCookie, adminId, 'editor');
    expect(response.status).toBe(400);
  });
});
