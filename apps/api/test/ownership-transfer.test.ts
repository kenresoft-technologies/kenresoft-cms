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

async function transfer(cookie: string, targetUserId: string) {
  return SELF.fetch('https://example.com/api/v1/admin/security/ownership/transfer', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId }),
  });
}

async function setDisabled(actorCookie: string, targetId: string, disabled: boolean) {
  return SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/disabled`, {
    method: 'PATCH',
    headers: { Cookie: actorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  });
}

async function roleOf(cookie: string, id: string): Promise<string | undefined> {
  const users = await (
    await SELF.fetch('https://example.com/api/v1/admin/users', { headers: { Cookie: cookie } })
  ).json<{ id: string; role: string }[]>();
  return users.find((u) => u.id === id)?.role;
}

describe('ownership transfer (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('an admin cannot transfer ownership, even with a fresh elevation', async () => {
    const ownerCookie = await authedCookie('ot-owner-1@example.test');
    const adminCookie = await authedCookie('ot-admin-1@example.test');
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');
    expect((await elevate(adminCookie)).status).toBe(200);

    const response = await transfer(adminCookie, await userId(ownerCookie));
    expect(response.status).toBe(403);
  });

  it('rejects a transfer attempt without a fresh elevation', async () => {
    const ownerCookie = await authedCookie('ot-owner-2@example.test');
    const editorCookie = await authedCookie('ot-editor-2@example.test');

    const response = await transfer(ownerCookie, await userId(editorCookie));
    expect(response.status).toBe(403);
  });

  it('transfers ownership atomically: the caller becomes admin, the target becomes owner', async () => {
    const ownerCookie = await authedCookie('ot-owner-3@example.test');
    const editorCookie = await authedCookie('ot-editor-3@example.test');
    const ownerId = await userId(ownerCookie);
    const editorId = await userId(editorCookie);

    expect((await elevate(ownerCookie)).status).toBe(200);
    const response = await transfer(ownerCookie, editorId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: editorId, role: 'owner' });

    expect(await roleOf(editorCookie, ownerId)).toBe('admin');
    expect(await roleOf(editorCookie, editorId)).toBe('owner');
  });

  it('rejects transferring ownership to yourself', async () => {
    const ownerCookie = await authedCookie('ot-owner-4@example.test');
    const ownerId = await userId(ownerCookie);
    expect((await elevate(ownerCookie)).status).toBe(200);

    const response = await transfer(ownerCookie, ownerId);
    expect(response.status).toBe(400);
  });

  it('rejects transferring ownership to a disabled account', async () => {
    const ownerCookie = await authedCookie('ot-owner-disabled@example.test');
    const targetCookie = await authedCookie('ot-target-disabled@example.test');
    const targetId = await userId(targetCookie);
    expect((await setDisabled(ownerCookie, targetId, true)).status).toBe(200);

    expect((await elevate(ownerCookie)).status).toBe(200);
    const response = await transfer(ownerCookie, targetId);
    expect(response.status).toBe(400);

    // Neither role changed — a rejected transfer must not partially apply.
    expect(await roleOf(ownerCookie, await userId(ownerCookie))).toBe('owner');
    expect(await roleOf(ownerCookie, targetId)).toBe('editor');
  });

  it('404s transferring to a nonexistent user', async () => {
    const ownerCookie = await authedCookie('ot-owner-5@example.test');
    expect((await elevate(ownerCookie)).status).toBe(200);

    const response = await transfer(ownerCookie, 'does-not-exist');
    expect(response.status).toBe(404);
  });

  it('the new owner can transfer ownership again, and the former owner (now admin) cannot', async () => {
    const firstOwnerCookie = await authedCookie('ot-owner-6@example.test');
    const secondCookie = await authedCookie('ot-second-6@example.test');
    const thirdCookie = await authedCookie('ot-third-6@example.test');
    const secondId = await userId(secondCookie);
    const thirdId = await userId(thirdCookie);

    expect((await elevate(firstOwnerCookie)).status).toBe(200);
    expect((await transfer(firstOwnerCookie, secondId)).status).toBe(200);

    // The former owner is now a plain admin — no ownership-transfer privilege left at all.
    expect((await elevate(firstOwnerCookie)).status).toBe(200);
    expect((await transfer(firstOwnerCookie, thirdId)).status).toBe(403);

    expect((await elevate(secondCookie)).status).toBe(200);
    const response = await transfer(secondCookie, thirdId);
    expect(response.status).toBe(200);
    expect(await roleOf(thirdCookie, thirdId)).toBe('owner');
    expect(await roleOf(thirdCookie, secondId)).toBe('admin');
  });

  it('rejects every security route without a session', async () => {
    const elevateRes = await SELF.fetch('https://example.com/api/v1/admin/security/elevate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(elevateRes.status).toBe(401);

    const transferRes = await SELF.fetch('https://example.com/api/v1/admin/security/ownership/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: 'whoever' }),
    });
    expect(transferRes.status).toBe(401);
  });
});
