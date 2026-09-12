import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function createContentType(headers: Record<string, string>): Promise<{ id: string }> {
  return (
    await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
    })
  ).json<{ id: string }>();
}

// Phase 1 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.6): field_definitions
// gained a `presentation` column, kept deliberately separate from `fieldType`/`required`/
// `config`. These tests cover exactly what docs/SITE_BUILDER.md's Phase 1 requirements call
// out: presentation omitted, presentation = null, round-tripping a real value, invalid
// renderer-config shapes rejected, and — critically — that every existing field-CRUD behavior
// (creation, listing, updating, unrelated fields) is unaffected by a field that never sets it.
describe('field presentation metadata (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('omitting presentation on create stores and returns null (backward compatible default)', async () => {
    const cookie = await authedCookie('presentation-omitted@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(headers);

    const res = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text' }),
    });
    expect(res.status).toBe(201);
    const field = await res.json<{ presentation: unknown }>();
    expect(field.presentation).toBeNull();
  });

  it('explicitly passing presentation: null on create is accepted and stored as null', async () => {
    const cookie = await authedCookie('presentation-null@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(headers);

    const res = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text', presentation: null }),
    });
    expect(res.status).toBe(201);
    const field = await res.json<{ presentation: unknown }>();
    expect(field.presentation).toBeNull();
  });

  it('a real presentation object round-trips through create, get-list, and update', async () => {
    const cookie = await authedCookie('presentation-roundtrip@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(headers);

    const created = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'score',
          label: 'Score',
          fieldType: 'number',
          presentation: { renderer: 'progressBar', variant: 'compact' },
        }),
      })
    ).json<{ id: string; presentation: { renderer?: string; variant?: string } | null }>();
    expect(created.presentation).toEqual({ renderer: 'progressBar', variant: 'compact' });

    const listed = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string; presentation: unknown }[]>();
    expect(listed.find((f) => f.id === created.id)?.presentation).toEqual({
      renderer: 'progressBar',
      variant: 'compact',
    });

    const updated = await (
      await SELF.fetch(
        `https://example.com/api/v1/admin/content-types/${contentType.id}/fields/${created.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ presentation: { renderer: 'chart' } }),
        },
      )
    ).json<{ presentation: unknown; fieldType: string; required: boolean }>();
    expect(updated.presentation).toEqual({ renderer: 'chart' });
    // Updating only presentation must not disturb the field's actual data/schema shape.
    expect(updated.fieldType).toBe('number');
    expect(updated.required).toBe(false);
  });

  it('an unrecognized presentation key is rejected (validation failure, not silently stored)', async () => {
    const cookie = await authedCookie('presentation-invalid@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(headers);

    const res = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'title',
        label: 'Title',
        fieldType: 'text',
        presentation: { arbitraryCodeToRun: 'process.exit(1)' },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('a field created before this feature (presentation never sent) is unaffected by unrelated updates', async () => {
    const cookie = await authedCookie('presentation-unaffected@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(headers);

    const created = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text' }),
      })
    ).json<{ id: string }>();

    const updated = await (
      await SELF.fetch(
        `https://example.com/api/v1/admin/content-types/${contentType.id}/fields/${created.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ label: 'Post Title' }) },
      )
    ).json<{ label: string; presentation: unknown }>();
    expect(updated.label).toBe('Post Title');
    expect(updated.presentation).toBeNull();
  });
});
