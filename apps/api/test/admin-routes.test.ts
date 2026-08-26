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
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM projects');
  });

  it('rejects every admin route without a session', async () => {
    const responses = await Promise.all([
      SELF.fetch('https://example.com/api/v1/admin/projects'),
      SELF.fetch('https://example.com/api/v1/admin/content-types?projectId=x'),
      SELF.fetch('https://example.com/api/v1/admin/entries?contentTypeId=x'),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it('walks the full authenticated CRUD flow: project -> content type -> field -> entry', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const projectRes = await SELF.fetch('https://example.com/api/v1/admin/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Pathvera Group', slug: 'pathvera' }),
    });
    expect(projectRes.status).toBe(201);
    const project = await projectRes.json<{ id: string; slug: string }>();
    expect(project.slug).toBe('pathvera');

    const listProjectsRes = await SELF.fetch('https://example.com/api/v1/admin/projects', {
      headers: { Cookie: cookie },
    });
    expect(await listProjectsRes.json()).toEqual([project]);

    const contentTypeRes = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId: project.id, name: 'Blog Post', slug: 'blog-post' }),
    });
    expect(contentTypeRes.status).toBe(201);
    const contentType = await contentTypeRes.json<{ id: string }>();

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
    const entry = await entryRes.json<{ id: string; status: string; projectId: string }>();
    expect(entry.status).toBe('draft');
    expect(entry.projectId).toBe(project.id);

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

  it('validates request bodies with Zod before touching the database', async () => {
    const cookie = await freshCookie();

    const response = await SELF.fetch('https://example.com/api/v1/admin/projects', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', slug: 'Not A Valid Slug' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe('Validation failed');
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
