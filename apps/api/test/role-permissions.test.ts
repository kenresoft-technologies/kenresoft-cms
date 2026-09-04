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

async function setRole(adminCookie: string, targetId: string, role: string) {
  await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

describe('role permissions (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('an author can only edit/delete entries they created, not another author\'s', async () => {
    const adminCookie = await authedCookie('perm-admin@example.test');
    const authorACookie = await authedCookie('perm-author-a@example.test');
    const authorBCookie = await authedCookie('perm-author-b@example.test');
    await setRole(adminCookie, await userId(authorACookie), 'author');
    await setRole(adminCookie, await userId(authorBCookie), 'author');

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers: { Cookie: authorACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'authors-own-post', data: {} }),
      })
    ).json<{ id: string }>();

    // Author B can't touch author A's entry.
    const otherEditAttempt = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'PATCH',
      headers: { Cookie: authorBCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'hijacked' }),
    });
    expect(otherEditAttempt.status).toBe(403);

    const otherDeleteAttempt = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'DELETE',
      headers: { Cookie: authorBCookie },
    });
    expect(otherDeleteAttempt.status).toBe(403);

    // Author A can edit and delete their own.
    const ownEditRes = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'PATCH',
      headers: { Cookie: authorACookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'authors-own-post-edited' }),
    });
    expect(ownEditRes.status).toBe(200);

    const ownDeleteRes = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'DELETE',
      headers: { Cookie: authorACookie },
    });
    expect(ownDeleteRes.status).toBe(204);
  });

  it('a viewer can read but never write, across admin routes', async () => {
    const adminCookie = await authedCookie('perm-viewer-admin@example.test');
    const viewerCookie = await authedCookie('perm-viewer@example.test');
    await setRole(adminCookie, await userId(viewerCookie), 'viewer');

    const readRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      headers: { Cookie: viewerCookie },
    });
    expect(readRes.status).toBe(200);

    const writeRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should fail', slug: 'should-fail' }),
    });
    expect(writeRes.status).toBe(403);

    const roleWriteRes = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope', email: 'nope@example.test' }),
    });
    expect(roleWriteRes.status).toBe(403);
  });

  it('an editor can add content-type fields but not create the content type itself', async () => {
    const adminCookie = await authedCookie('perm-field-admin@example.test');
    const editorCookie = await authedCookie('perm-field-editor@example.test');

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const editorCreateCtAttempt = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Service', slug: 'service' }),
    });
    expect(editorCreateCtAttempt.status).toBe(403);

    const editorAddFieldRes = await SELF.fetch(
      `https://example.com/api/v1/admin/content-types/${contentType.id}/fields`,
      {
        method: 'POST',
        headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text' }),
      },
    );
    expect(editorAddFieldRes.status).toBe(201);
  });

  it('an admin can list and revoke another user\'s sessions', async () => {
    const adminCookie = await authedCookie('perm-session-admin@example.test');
    const editorCookie = await authedCookie('perm-session-editor@example.test');
    const editorId = await userId(editorCookie);

    const editorAttempt = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}/sessions`, {
      headers: { Cookie: editorCookie },
    });
    expect(editorAttempt.status).toBe(403);

    const listRes = await SELF.fetch(`https://example.com/api/v1/admin/users/${editorId}/sessions`, {
      headers: { Cookie: adminCookie },
    });
    expect(listRes.status).toBe(200);
    const sessions = await listRes.json<{ id: string }[]>();
    expect(sessions).toHaveLength(1);

    const revokeRes = await SELF.fetch(
      `https://example.com/api/v1/admin/users/${editorId}/sessions/${sessions[0]!.id}`,
      { method: 'DELETE', headers: { Cookie: adminCookie } },
    );
    expect(revokeRes.status).toBe(204);

    // The revoked session's cookie no longer authenticates.
    const afterRevoke = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
      headers: { Cookie: editorCookie },
    });
    const body = await afterRevoke.json();
    expect(body).toBeNull();
  });
});
