import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

const PASSWORD = 'correct horse battery staple';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: PASSWORD, name: 'Test User' });
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
    const ownerCookie = await authedCookie('op-owner-1@example.test');
    const adminCookie = await authedCookie('op-admin-1@example.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');

    // Not 403: a non-owner can't even confirm the target exists (see the visibility tests below).
    const response = await setRole(adminCookie, ownerId, 'editor');
    expect(response.status).toBe(404);

    const list = await (
      await SELF.fetch('https://example.com/api/v1/admin/users', { headers: { Cookie: ownerCookie } })
    ).json<{ id: string; role: string }[]>();
    expect(list.find((u) => u.id === ownerId)?.role).toBe('owner');
  });

  it('an admin cannot delete the owner', async () => {
    const ownerCookie = await authedCookie('op-owner-2@example.test');
    const adminCookie = await authedCookie('op-admin-2@example.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(404);
  });

  it('an admin cannot disable the owner, even with a fresh elevation', async () => {
    const ownerCookie = await authedCookie('op-owner-3@example.test');
    const adminCookie = await authedCookie('op-admin-3@example.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');
    expect((await elevate(adminCookie)).status).toBe(200);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${ownerId}/disabled`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(response.status).toBe(404);
  });

  it('owner can create an admin, and can later remove them', async () => {
    const ownerCookie = await authedCookie('op-owner-4@example.test');
    const created = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Admin', email: 'op-new-admin-4@example.test' }),
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
    const ownerCookie = await authedCookie('op-owner-5@example.test');
    const targetCookie = await authedCookie('op-target-5@example.test');
    const actorCookie = await authedCookie('op-actor-5@example.test');
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
    const ownerCookie = await authedCookie('op-owner-6@example.test');
    const editorCookie = await authedCookie('op-editor-6@example.test');
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
    const ownerCookie = await authedCookie('op-owner-8@example.test');
    const adminCookie = await authedCookie('op-admin-8@example.test');
    const ownerId = await userId(ownerCookie);
    const adminId = await userId(adminCookie);
    await setRole(ownerCookie, adminId, 'admin');
    await env.DB.exec(`DELETE FROM session WHERE user_id = '${ownerId}'`);
    await env.DB.exec(`DELETE FROM account WHERE user_id = '${ownerId}'`);
    await env.DB.exec(`DELETE FROM user WHERE id = '${ownerId}'`);

    const response = await setRole(adminCookie, adminId, 'editor');
    expect(response.status).toBe(400);
  });

  describe('the Owner is invisible to everyone else', () => {
    async function setup(prefix: string) {
      const ownerCookie = await authedCookie(`${prefix}-owner@example.test`);
      const ownerId = await userId(ownerCookie);
      const cookies: Record<string, string> = {};
      const ids: Record<string, string> = {};
      for (const role of ['admin', 'editor', 'viewer']) {
        cookies[role] = await authedCookie(`${prefix}-${role}@example.test`);
        ids[role] = await userId(cookies[role]!);
        expect((await setRole(ownerCookie, ids[role]!, role)).status).toBe(200);
      }
      return { ownerCookie, ownerId, cookies, ids };
    }

    it('admin, editor and viewer never see the owner in the users list; the owner sees everyone', async () => {
      const { ownerCookie, ownerId, cookies } = await setup('vis-list');

      for (const role of ['admin', 'editor', 'viewer']) {
        const list = await (
          await SELF.fetch('https://example.com/api/v1/admin/users', { headers: { Cookie: cookies[role]! } })
        ).json<{ id: string; role: string; email: string }[]>();
        expect(list.some((u) => u.id === ownerId || u.role === 'owner')).toBe(false);
        expect(list.some((u) => u.email.includes('owner@'))).toBe(false);
        // No rigid hierarchy between the three: each still sees the other two.
        expect(list.map((u) => u.role).sort()).toEqual(['admin', 'editor', 'viewer']);
      }

      const ownerList = await (
        await SELF.fetch('https://example.com/api/v1/admin/users', { headers: { Cookie: ownerCookie } })
      ).json<{ id: string }[]>();
      expect(ownerList.some((u) => u.id === ownerId)).toBe(true);
      expect(ownerList).toHaveLength(4);
    });

    it('every direct lookup of the owner by a non-owner is an indistinguishable 404', async () => {
      const { ownerId, cookies } = await setup('vis-direct');
      const base = `https://example.com/api/v1/admin/users/${ownerId}`;
      const json = { 'Content-Type': 'application/json' };
      const missing = 'https://example.com/api/v1/admin/users/does-not-exist';

      const attempts: Array<[string, RequestInit]> = [
        ['/role', { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) }],
        ['/disabled', { method: 'PATCH', body: JSON.stringify({ disabled: true }) }],
        ['/developer-tools-access', { method: 'PATCH', body: JSON.stringify({ developerToolsAccess: true }) }],
        ['/sessions', { method: 'GET' }],
        ['', { method: 'DELETE' }],
      ];

      for (const role of ['admin', 'editor', 'viewer']) {
        for (const [suffix, init] of attempts) {
          const real = await SELF.fetch(`${base}${suffix}`, { ...init, headers: { ...json, Cookie: cookies[role]! } });
          const fake = await SELF.fetch(`${missing}${suffix}`, { ...init, headers: { ...json, Cookie: cookies[role]! } });
          // Viewer mutations are blocked globally (403) before reaching the route; either way the
          // owner must look exactly like a nonexistent id.
          expect(real.status).toBe(fake.status);
          expect(await real.text()).toBe(await fake.text());
        }
      }
    });

    it('the owner does not appear in the audit log for a non-owner admin, but does for the owner', async () => {
      const { ownerCookie, ownerId, cookies } = await setup('vis-audit');

      const adminRows = await (
        await SELF.fetch('https://example.com/api/v1/admin/audit-log?limit=200', { headers: { Cookie: cookies.admin! } })
      ).json<{ actorUserId: string | null; targetId: string | null; actorEmail: string | null }[]>();
      expect(adminRows.length).toBeGreaterThan(0);
      expect(adminRows.some((r) => r.actorUserId === ownerId || r.targetId === ownerId)).toBe(false);
      expect(adminRows.some((r) => r.actorEmail?.includes('-owner@'))).toBe(false);

      const ownerRows = await (
        await SELF.fetch('https://example.com/api/v1/admin/audit-log?limit=200', { headers: { Cookie: ownerCookie } })
      ).json<{ actorUserId: string | null }[]>();
      expect(ownerRows.some((r) => r.actorUserId === ownerId)).toBe(true);
    });

    it('a user cannot be promoted to owner through the role route, by anyone', async () => {
      const { ownerCookie, ids } = await setup('vis-promote');
      const response = await setRole(ownerCookie, ids.admin!, 'owner');
      expect(response.status).toBe(403);
    });
  });
});
