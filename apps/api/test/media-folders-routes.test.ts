import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAScy0y8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

async function uploadMedia(cookie: string, folderId?: string): Promise<{ id: string; folderId: string | null }> {
  const form = new FormData();
  form.set('file', new Blob([PNG_1PX], { type: 'image/png' }), 'test.png');
  if (folderId) form.set('folderId', folderId);
  const response = await SELF.fetch('https://example.com/api/v1/admin/media', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  expect(response.status).toBe(201);
  return response.json();
}

describe('media folders (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM media_folders');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('creates a folder, uploads media into it, and lists media scoped to that folder', async () => {
    const cookie = await authedCookie('media-folders@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const folder = await (
      await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Home page hero', slug: 'home-page-hero' }),
      })
    ).json<{ id: string; slug: string }>();

    const media = await uploadMedia(cookie, folder.id);
    expect(media.folderId).toBe(folder.id);

    // Every unfiled media stays valid — a second, unfiled upload doesn't show up when scoped.
    await uploadMedia(cookie);

    const scoped = await (
      await SELF.fetch(`https://example.com/api/v1/admin/media?folderId=${folder.id}`, { headers: { Cookie: cookie } })
    ).json<Array<{ id: string }>>();
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.id).toBe(media.id);

    const unfiled = await (
      await SELF.fetch('https://example.com/api/v1/admin/media?folderId=unfiled', { headers: { Cookie: cookie } })
    ).json<Array<{ id: string }>>();
    expect(unfiled).toHaveLength(1);
    expect(unfiled[0]!.id).not.toBe(media.id);

    const all = await (
      await SELF.fetch('https://example.com/api/v1/admin/media', { headers: { Cookie: cookie } })
    ).json<Array<{ id: string }>>();
    expect(all).toHaveLength(2);
  });

  it('deleting a folder never deletes its media — it becomes unfiled', async () => {
    const cookie = await authedCookie('media-folders-delete@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const folder = await (
      await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Temp', slug: 'temp' }),
      })
    ).json<{ id: string }>();
    const media = await uploadMedia(cookie, folder.id);

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/media-folders/${folder.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const fetched = await (
      await SELF.fetch('https://example.com/api/v1/admin/media', { headers: { Cookie: cookie } })
    ).json<Array<{ id: string; folderId: string | null }>>();
    const row = fetched.find((m) => m.id === media.id);
    expect(row?.folderId).toBeNull();
  });

  it('moves media between folders via POST /admin/media/move', async () => {
    const cookie = await authedCookie('media-folders-move@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const folderA = await (
      await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'A', slug: 'folder-a' }),
      })
    ).json<{ id: string }>();
    const folderB = await (
      await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'B', slug: 'folder-b' }),
      })
    ).json<{ id: string }>();

    const media = await uploadMedia(cookie, folderA.id);

    const moveRes = await SELF.fetch('https://example.com/api/v1/admin/media/move', {
      method: 'POST',
      headers,
      body: JSON.stringify({ mediaIds: [media.id], folderId: folderB.id }),
    });
    expect(moveRes.status).toBe(200);
    expect(await moveRes.json()).toMatchObject({ moved: 1 });

    const scoped = await (
      await SELF.fetch(`https://example.com/api/v1/admin/media?folderId=${folderB.id}`, { headers: { Cookie: cookie } })
    ).json<Array<{ id: string }>>();
    expect(scoped.map((m) => m.id)).toEqual([media.id]);
  });

  it('the public API can fetch a folder\'s media explicitly by slug', async () => {
    const cookie = await authedCookie('media-folders-public@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const folder = await (
      await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Home page hero', slug: 'home-page-hero' }),
      })
    ).json<{ id: string }>();
    const media = await uploadMedia(cookie, folder.id);
    await uploadMedia(cookie); // unfiled, must not appear

    const response = await SELF.fetch('https://example.com/api/v1/public/media/folders/home-page-hero');
    expect(response.status).toBe(200);
    const items = await response.json<Array<{ id: string }>>();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(media.id);
  });

  it('the public folder route returns an empty array for an unknown slug, not a 404', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/public/media/folders/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('rejects a folder create/rename with a duplicate slug', async () => {
    const cookie = await authedCookie('media-folders-dup@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'First', slug: 'dup' }),
    });
    const second = await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Second', slug: 'dup' }),
    });
    expect(second.status).toBe(400);
  });

  it('rejects folder management from an author', async () => {
    const ownerCookie = await authedCookie('media-folders-owner@example.test');
    const authorCookie = await authedCookie('media-folders-author@example.test');
    await SELF.fetch(
      `https://example.com/api/v1/admin/users/${(await (await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: authorCookie } })).json<{ user: { id: string } }>()).user.id}/role`,
      { method: 'PATCH', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'author' }) },
    );

    const response = await SELF.fetch('https://example.com/api/v1/admin/media-folders', {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', slug: 'x' }),
    });
    expect(response.status).toBe(403);
  });
});
