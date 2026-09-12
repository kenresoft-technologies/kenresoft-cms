import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §4.1/§13): admin Templates
// CRUD, sharing the same block-tree validation Pages already use.
async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test User',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

function createTemplate(headers: Record<string, string>, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/v1/admin/templates', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('admin templates (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM pages');
    await env.DB.exec('DELETE FROM templates');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('creates, fetches, lists, updates, and deletes a template', async () => {
    const headers = await authedHeaders('templates-crud@example.test');

    const created = await (
      await createTemplate(headers, {
        name: 'Landing page',
        blocks: [{ id: 'hero-1', type: 'hero', config: { heading: 'Welcome' } }],
      })
    ).json<{ id: string; name: string; contentTypeId: string | null; isDefault: boolean }>();
    expect(created.name).toBe('Landing page');
    expect(created.contentTypeId).toBeNull();
    expect(created.isDefault).toBe(false);

    const fetched = await (
      await SELF.fetch(`https://example.com/api/v1/admin/templates/${created.id}`, {
        headers: { Cookie: headers.Cookie! },
      })
    ).json<{ blocks: unknown[] }>();
    expect(fetched.blocks).toHaveLength(1);

    const list = await (
      await SELF.fetch('https://example.com/api/v1/admin/templates', { headers: { Cookie: headers.Cookie! } })
    ).json<{ id: string }[]>();
    expect(list.some((t) => t.id === created.id)).toBe(true);

    const updated = await (
      await SELF.fetch(`https://example.com/api/v1/admin/templates/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Landing page (v2)', isDefault: true }),
      })
    ).json<{ name: string; isDefault: boolean }>();
    expect(updated.name).toBe('Landing page (v2)');
    expect(updated.isDefault).toBe(true);

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/templates/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: headers.Cookie! },
    });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await SELF.fetch(`https://example.com/api/v1/admin/templates/${created.id}`, {
      headers: { Cookie: headers.Cookie! },
    });
    expect(afterDelete.status).toBe(404);
  });

  it('rejects an invalid block config and accepts a content-type scoped template', async () => {
    const headers = await authedHeaders('templates-validation@example.test');

    const invalid = await createTemplate(headers, {
      name: 'Broken',
      blocks: [{ id: 'hero-1', type: 'hero', config: { heading: 123 } }],
    });
    expect(invalid.status).toBe(400);

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const scoped = await (
      await createTemplate(headers, { name: 'Blog template', contentTypeId: contentType.id, blocks: [] })
    ).json<{ contentTypeId: string | null }>();
    expect(scoped.contentTypeId).toBe(contentType.id);
  });
});
