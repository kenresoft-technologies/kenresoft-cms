import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test User',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

async function createContentType(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ id: string; slug: string; name: string }> {
  const res = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function createField(
  headers: Record<string, string>,
  contentTypeId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentTypeId}/fields`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function createEntry(
  headers: Record<string, string>,
  contentTypeId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentTypeId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

// DELETE /api/v1/admin/content-types/:id — closes a real gap: there was previously no way to
// remove a content type at all, only its fields/entries individually. Fields and entries
// cascade at the database level (packages/database/schema); a `reference` field on another
// content type is only a JSON config value, not a real FK, so it's checked in application code
// and blocks the delete with a 409 instead of silently leaving it dangling.
describe('content type deletion (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('deletes a content type along with its fields and entries', async () => {
    const headers = await authedHeaders('delete-cascade@example.test');
    const contentType = await createContentType(headers, { name: 'Note', slug: 'note' });
    const field = await createField(headers, contentType.id, {
      name: 'title',
      label: 'Title',
      fieldType: 'text',
      required: false,
    });
    const entry = await createEntry(headers, contentType.id, { slug: 'hello', data: { title: 'Hello' } });

    const del = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(del.status).toBe(204);

    const getCt = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}`, {
      headers: { Cookie: headers.Cookie! },
    });
    expect(getCt.status).toBe(404);

    const fieldRow = await env.DB.prepare('SELECT id FROM field_definitions WHERE id = ?').bind(field.id).first();
    expect(fieldRow).toBeNull();
    const entryRow = await env.DB.prepare('SELECT id FROM entries WHERE id = ?').bind(entry.id).first();
    expect(entryRow).toBeNull();
  });

  it('rejects deletion with 409 when another content type has a reference field targeting it, and audit-logs a successful delete', async () => {
    const headers = await authedHeaders('delete-referenced@example.test');
    const author = await createContentType(headers, { name: 'Author', slug: 'author' });
    const post = await createContentType(headers, { name: 'Post', slug: 'post' });
    await createField(headers, post.id, {
      name: 'author',
      label: 'Author',
      fieldType: 'reference',
      required: false,
      config: { targetContentTypeId: author.id },
    });

    const blocked = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${author.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(blocked.status).toBe(409);
    const body = await blocked.json<{ referencedBy: { contentTypeName: string; fieldLabel: string }[] }>();
    expect(body.referencedBy).toEqual([{ contentTypeId: post.id, contentTypeName: 'Post', fieldLabel: 'Author' }]);

    // Deleting the referencing content type itself is unaffected — nothing points at it.
    const del = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${post.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(del.status).toBe(204);

    const auditRow = await env.DB.prepare(
      "SELECT target_id FROM audit_log WHERE action = 'content_type.deleted' AND target_id = ?",
    )
      .bind(post.id)
      .first();
    expect(auditRow).not.toBeNull();
  });

  it('is admin-only and 404s for an unknown id', async () => {
    // Explicit roles for both — otherwise the first sign-up in this test's isolated D1 would be
    // auto-promoted to Owner by the test helper's own default convenience behavior.
    const editorCookie = await signUpVerifiedAndGetCookie('delete-editor@example.test', {
      password: 'correct horse battery staple',
      name: 'Editor User',
      role: 'editor',
    });
    const adminCookie = await signUpVerifiedAndGetCookie('delete-admin@example.test', {
      password: 'correct horse battery staple',
      name: 'Admin User',
      role: 'admin',
    });
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const contentType = await createContentType(adminHeaders, { name: 'Note', slug: 'note-role' });

    const asEditor = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}`, {
      method: 'DELETE',
      headers: { Cookie: editorCookie },
    });
    expect(asEditor.status).toBe(403);

    const missing = await SELF.fetch('https://example.com/api/v1/admin/content-types/does-not-exist', {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(missing.status).toBe(404);
  });
});
