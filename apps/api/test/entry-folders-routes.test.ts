import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function createContentType(cookie: string, slug: string): Promise<{ id: string }> {
  const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: slug, slug }),
  });
  return response.json();
}

async function createEntry(cookie: string, contentTypeId: string, slug: string): Promise<{ id: string }> {
  const response = await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentTypeId}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, data: {} }),
  });
  return response.json();
}

describe('entry folders (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM entry_folders');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('creates a folder, moves an entry into it, and lists entries scoped by folder', async () => {
    const cookie = await authedCookie('entry-folders@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(cookie, 'blog-post-ef');

    const folder = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: '2026' }),
      })
    ).json<{ id: string; parentId: string | null }>();
    expect(folder.parentId).toBeNull();

    const entry = await createEntry(cookie, contentType.id, 'post-a');
    await createEntry(cookie, contentType.id, 'post-b'); // stays unfiled

    const moveRes = await SELF.fetch('https://example.com/api/v1/admin/entry-folders/move', {
      method: 'POST',
      headers,
      body: JSON.stringify({ entryIds: [entry.id], folderId: folder.id }),
    });
    expect(moveRes.status).toBe(200);
    const moved = await moveRes.json<Array<{ id: string; folderId: string | null }>>();
    expect(moved).toHaveLength(1);
    expect(moved[0]!.folderId).toBe(folder.id);

    const scoped = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}&folderId=${folder.id}`, {
        headers: { Cookie: cookie },
      })
    ).json<Array<{ id: string }>>();
    expect(scoped.map((e) => e.id)).toEqual([entry.id]);

    const unfiled = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}&folderId=unfiled`, {
        headers: { Cookie: cookie },
      })
    ).json<Array<{ id: string }>>();
    expect(unfiled).toHaveLength(1);
    expect(unfiled[0]!.id).not.toBe(entry.id);
  });

  it('supports nested folders and a rename/reparent, rejecting cycles', async () => {
    const cookie = await authedCookie('entry-folders-nested@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(cookie, 'blog-post-nested');

    const parent = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Parent' }),
      })
    ).json<{ id: string }>();
    const child = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Child', parentId: parent.id }),
      })
    ).json<{ id: string; parentId: string | null }>();
    expect(child.parentId).toBe(parent.id);

    // Cycle: moving parent under its own child must be rejected.
    const cycleRes = await SELF.fetch(`https://example.com/api/v1/admin/entry-folders/${parent.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ parentId: child.id }),
    });
    expect(cycleRes.status).toBe(400);

    const renameRes = await SELF.fetch(`https://example.com/api/v1/admin/entry-folders/${child.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Renamed child' }),
    });
    expect(renameRes.status).toBe(200);
    expect((await renameRes.json<{ name: string }>()).name).toBe('Renamed child');
  });

  it('deleting a folder never deletes its entries — they become unfiled, and child folders move to root', async () => {
    const cookie = await authedCookie('entry-folders-delete@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(cookie, 'blog-post-del');

    const parent = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Parent' }),
      })
    ).json<{ id: string }>();
    const child = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Child', parentId: parent.id }),
      })
    ).json<{ id: string }>();
    const entry = await createEntry(cookie, contentType.id, 'post-c');
    await SELF.fetch('https://example.com/api/v1/admin/entry-folders/move', {
      method: 'POST',
      headers,
      body: JSON.stringify({ entryIds: [entry.id], folderId: parent.id }),
    });

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/entry-folders/${parent.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const entries = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        headers: { Cookie: cookie },
      })
    ).json<Array<{ id: string; folderId: string | null }>>();
    expect(entries.find((e) => e.id === entry.id)?.folderId).toBeNull();

    const folders = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        headers: { Cookie: cookie },
      })
    ).json<Array<{ id: string; parentId: string | null }>>();
    expect(folders.find((f) => f.id === child.id)?.parentId).toBeNull();
  });

  it('an author can only move their own entries', async () => {
    const adminCookie = await authedCookie('entry-folders-admin@example.test');
    const authorCookie = await authedCookie('entry-folders-author@example.test');
    const authorId = (
      await (
        await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: authorCookie } })
      ).json<{ user: { id: string } }>()
    ).user.id;
    await SELF.fetch(`https://example.com/api/v1/admin/users/${authorId}/role`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'author' }),
    });

    const contentType = await createContentType(adminCookie, 'blog-post-author');
    const adminEntry = await createEntry(adminCookie, contentType.id, 'admin-post');
    const folder = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Team folder' }),
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch('https://example.com/api/v1/admin/entry-folders/move', {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryIds: [adminEntry.id], folderId: folder.id }),
    });
    expect(response.status).toBe(403);
  });

  it('rejects a duplicate sibling folder name', async () => {
    const cookie = await authedCookie('entry-folders-dup@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(cookie, 'blog-post-dup');

    await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Same' }),
    });
    const second = await SELF.fetch(`https://example.com/api/v1/admin/entry-folders?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Same' }),
    });
    expect(second.status).toBe(400);
  });
});
