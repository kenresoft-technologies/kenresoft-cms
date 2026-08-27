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

let cookieCounter = 0;
async function freshCookie(): Promise<string> {
  cookieCounter += 1;
  return authedCookie(`admin-routes-${cookieCounter}@pathvera.test`);
}

describe('admin routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    // Cleared every test so the first signup within each test is deterministically the
    // owner (see src/lib/auth.ts's databaseHooks.user.create.before).
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects every admin route without a session', async () => {
    const responses = await Promise.all([
      SELF.fetch('https://example.com/api/v1/admin/content-types'),
      SELF.fetch('https://example.com/api/v1/admin/entries?contentTypeId=x'),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it('walks the full authenticated CRUD flow: content type -> field -> entry', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentTypeRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
    });
    expect(contentTypeRes.status).toBe(201);
    const contentType = await contentTypeRes.json<{ id: string }>();

    const getContentTypeRes = await SELF.fetch(
      `https://example.com/api/v1/admin/content-types/${contentType.id}`,
      { headers: { Cookie: cookie } },
    );
    expect(await getContentTypeRes.json()).toEqual(contentType);

    const fieldRes = await SELF.fetch(
      `https://example.com/api/v1/admin/content-types/${contentType.id}/fields`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text', required: true }),
      },
    );
    expect(fieldRes.status).toBe(201);
    const field = await fieldRes.json<{ name: string; required: boolean }>();
    expect(field).toMatchObject({ name: 'title', required: true });

    const entryRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'hello-world', data: { title: 'Hello World' } }),
      },
    );
    expect(entryRes.status).toBe(201);
    const entry = await entryRes.json<{ id: string; status: string }>();
    expect(entry.status).toBe('draft');

    const patchRes = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'published' }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ status: 'published' });

    const getRes = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      headers: { Cookie: cookie },
    });
    expect(await getRes.json()).toMatchObject({ status: 'published' });

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const afterDeleteRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/${entry.id}`,
      { headers: { Cookie: cookie } },
    );
    expect(afterDeleteRes.status).toBe(404);
  });

  it('persists the creating user as the entry author, surfaced via the unified entries listing', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentTypeRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
    });
    const contentType = await contentTypeRes.json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'hello-world', data: {} }),
    });

    const listRes = await SELF.fetch('https://example.com/api/v1/admin/entries', {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const listed = await listRes.json<{ slug: string; authorEmail: string | null }[]>();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.slug).toBe('hello-world');
    expect(listed[0]!.authorEmail).toMatch(/@pathvera\.test$/);
  });

  it('the unified entries listing (no contentTypeId) spans every content type', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const blogRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
    });
    const blog = await blogRes.json<{ id: string }>();

    const serviceRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Service', slug: 'service' }),
    });
    const service = await serviceRes.json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${blog.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'hello-world', data: {} }),
    });
    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${service.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'admissions-support', data: {} }),
    });

    const listRes = await SELF.fetch('https://example.com/api/v1/admin/entries', {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const listed = await listRes.json<{ slug: string; contentTypeName: string; contentTypeSlug: string }[]>();
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'hello-world', contentTypeName: 'Blog Post', contentTypeSlug: 'blog-post' }),
        expect.objectContaining({
          slug: 'admissions-support',
          contentTypeName: 'Service',
          contentTypeSlug: 'service',
        }),
      ]),
    );

    // The scoped form (contentTypeId set) uses the same joined shape, just filtered to one
    // content type — so the per-content-type Entries page can show an Author column too, not
    // just the unified one.
    const scopedRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries?contentTypeId=${blog.id}`,
      { headers: { Cookie: cookie } },
    );
    const scoped = await scopedRes.json<{ slug: string; contentTypeName: string }[]>();
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ slug: 'hello-world', contentTypeName: 'Blog Post' });
  });

  it('orders fields by creation order, not alphabetically, when sortOrder is omitted', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    for (const name of ['title', 'body', 'excerpt']) {
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, label: name, fieldType: 'text' }),
      });
    }

    const fields = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        headers: { Cookie: cookie },
      })
    ).json<{ name: string }[]>();
    expect(fields.map((f) => f.name)).toEqual(['title', 'body', 'excerpt']);
  });

  it('validates request bodies with Zod before touching the database', async () => {
    const cookie = await freshCookie();

    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', slug: 'Not A Valid Slug' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe('Validation failed');
  });

  it('404s fetching a non-existent content type', async () => {
    const cookie = await freshCookie();

    const response = await SELF.fetch(
      'https://example.com/api/v1/admin/content-types/does-not-exist',
      { headers: { Cookie: cookie } },
    );

    expect(response.status).toBe(404);
  });

  it('bootstraps the first signup as owner and rejects content-type creation from an editor', async () => {
    const ownerCookie = await freshCookie();
    const editorCookie = await freshCookie();

    const ownerRes = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
      headers: { Cookie: ownerCookie },
    });
    expect((await ownerRes.json<{ user: { role: string } }>()).user.role).toBe('owner');

    const editorSessionRes = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
      headers: { Cookie: editorCookie },
    });
    expect((await editorSessionRes.json<{ user: { role: string } }>()).user.role).toBe('editor');

    const editorCreateRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Fail', slug: 'should-fail' }),
    });
    expect(editorCreateRes.status).toBe(403);

    const ownerCreateRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Succeed', slug: 'should-succeed' }),
    });
    expect(ownerCreateRes.status).toBe(201);
  });

  it('records revisions on write and can restore an entry to a past one', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'hello-world', data: { title: 'Original title' } }),
      })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ data: { title: 'Edited title' } }),
    });

    const revisionsRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/${entry.id}/revisions`,
      { headers: { Cookie: cookie } },
    );
    expect(revisionsRes.status).toBe(200);
    const revisions = await revisionsRes.json<{ id: string; data: { title: string } }[]>();
    // Newest first: the pre-edit snapshot (still "Original title"), then the creation snapshot.
    expect(revisions).toHaveLength(2);
    expect(revisions[0]!.data.title).toBe('Original title');

    const restoreRes = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/${entry.id}/revisions/${revisions[0]!.id}/restore`,
      { method: 'POST', headers: { Cookie: cookie } },
    );
    expect(restoreRes.status).toBe(200);
    expect(await restoreRes.json()).toMatchObject({ data: { title: 'Original title' } });

    // Restoring itself snapshotted the pre-restore ("Edited title") state, so it's undoable too.
    const revisionsAfterRestore = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}/revisions`, {
        headers: { Cookie: cookie },
      })
    ).json<{ data: { title: string } }[]>();
    expect(revisionsAfterRestore).toHaveLength(3);
    expect(revisionsAfterRestore[0]!.data.title).toBe('Edited title');
  });

  it('404s restoring a non-existent revision', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();
    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'hello-world', data: {} }),
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/entries/${entry.id}/revisions/does-not-exist/restore`,
      { method: 'POST', headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(404);
  });

  it('404s when creating an entry under a non-existent content type', async () => {
    const cookie = await freshCookie();

    const response = await SELF.fetch(
      'https://example.com/api/v1/admin/entries?contentTypeId=does-not-exist',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'x', data: {} }),
      },
    );

    expect(response.status).toBe(404);
  });
});
