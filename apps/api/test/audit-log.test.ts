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
  return authedCookie(`audit-log-${cookieCounter}@pathvera.test`);
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
}

async function fetchAuditLog(cookie: string, query = ''): Promise<AuditEntry[]> {
  const response = await SELF.fetch(`https://example.com/api/v1/admin/audit-log${query}`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return response.json<AuditEntry[]>();
}

describe('audit log (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM audit_log');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM form_fields');
    await env.DB.exec('DELETE FROM forms');
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects the list route without a session, and for a non-admin', async () => {
    const anonymous = await SELF.fetch('https://example.com/api/v1/admin/audit-log');
    expect(anonymous.status).toBe(401);

    await freshCookie(); // claim owner
    const editorCookie = await freshCookie(); // defaults to editor
    const forbidden = await SELF.fetch('https://example.com/api/v1/admin/audit-log', {
      headers: { Cookie: editorCookie },
    });
    expect(forbidden.status).toBe(403);
  });

  // Deliberately does not exercise a real wrong-password sign-in here (unlike the live
  // wrangler-dev verification, which does and passed — see CLAUDE.md) — calling better-auth's
  // real internals with a wrong password triggers an unhandled promise rejection somewhere
  // inside better-auth/better-call independent of the correct 401 the route itself returns,
  // which fails the whole vitest process on CI regardless of any assertion's own outcome. This
  // is the exact same class of pre-existing issue commit 6b041b9 already worked around for
  // security-elevate — auth.sign_in_failed logging itself is covered by the real live-instance
  // pass instead, not by this file.
  it('records auth.sign_up, auth.sign_in, and auth.sign_out', async () => {
    const email = 'audit-auth@pathvera.test';
    const cookie = await authedCookie(email);

    await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse battery staple' }),
    });
    // better-auth's origin-check middleware requires a real Origin header on state-changing
    // auth requests like sign-out (CSRF protection) — a real browser always sends one; the
    // sign-up/sign-in calls above don't need it explicitly for reasons internal to those
    // endpoints, but sign-out does.
    const signOutRes = await SELF.fetch('https://example.com/api/v1/auth/sign-out', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    });
    expect(signOutRes.status).toBe(200);

    // The sign-out above just killed `cookie`'s own session — sign back in for a fresh one to
    // view the log with (this owner is the only account, so there's no other valid session).
    const freshLogin = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse battery staple' }),
    });
    const freshCookieValue = freshLogin.headers.get('set-cookie')!.split(';')[0]!;

    const entries = await fetchAuditLog(freshCookieValue);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('auth.sign_up');
    expect(actions).toContain('auth.sign_in');
    expect(actions).toContain('auth.sign_out');
  });

  it('records content-type, field, entry, form, form-field, and media actions', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const field = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'title', label: 'Title', fieldType: 'text', required: true }),
      })
    ).json<{ id: string }>();
    await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields/${field.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ label: 'Post title' }),
    });
    await SELF.fetch(`https://example.com/api/v1/admin/content-types/${contentType.id}/fields/${field.id}`, {
      method: 'DELETE',
      headers,
    });

    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'hello-world', status: 'published', data: { title: 'Hello' } }),
      })
    ).json<{ id: string }>();
    await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'draft' }),
    });
    await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, { method: 'DELETE', headers });

    const form = await (
      await SELF.fetch('https://example.com/api/v1/admin/forms', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Contact', slug: 'contact' }),
      })
    ).json<{ id: string }>();
    const formField = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'email', label: 'Email', fieldType: 'email', required: true }),
      })
    ).json<{ id: string }>();
    await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields/${formField.id}`, {
      method: 'DELETE',
      headers,
    });

    const uploadForm = new FormData();
    uploadForm.set('file', new File([pngBytes(64, 64)], 'photo.png', { type: 'image/png' }));
    const media = await (
      await SELF.fetch('https://example.com/api/v1/admin/media', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: uploadForm,
      })
    ).json<{ id: string }>();
    await SELF.fetch(`https://example.com/api/v1/admin/media/${media.id}`, { method: 'DELETE', headers });

    const entries = await fetchAuditLog(cookie, '?limit=200');
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'content_type.created',
        'field.created',
        'field.updated',
        'field.deleted',
        'entry.created',
        'entry.published',
        'entry.updated',
        'entry.unpublished',
        'entry.deleted',
        'form.created',
        'form_field.created',
        'form_field.deleted',
        'media.uploaded',
        'media.deleted',
      ]),
    );
    // Every logged action here traces to the one signed-in owner making these calls.
    expect(entries.every((e) => e.actorUserId !== null)).toBe(true);
  });

  it('filters by action and by actorUserId', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
    });

    const byAction = await fetchAuditLog(cookie, '?action=content_type.created');
    expect(byAction).toHaveLength(1);
    expect(byAction[0]!.action).toBe('content_type.created');

    const actorId = byAction[0]!.actorUserId!;
    const byActor = await fetchAuditLog(cookie, `?actorUserId=${actorId}`);
    expect(byActor.length).toBeGreaterThan(0);
    expect(byActor.every((e) => e.actorUserId === actorId)).toBe(true);

    const noMatch = await fetchAuditLog(cookie, '?action=nonexistent.action');
    expect(noMatch).toEqual([]);
  });
});
