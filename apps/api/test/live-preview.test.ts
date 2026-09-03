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
  return authedCookie(`live-preview-${cookieCounter}@pathvera.test`);
}

describe('Live Preview (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  async function setUpDraftEntry(cookie: string) {
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string; slug: string }>();
    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'draft-post', status: 'draft', data: { title: 'Unpublished' } }),
      })
    ).json<{ id: string; slug: string }>();
    return { contentType, entry };
  }

  it('the normal public route 404s a draft exactly like a nonexistent slug (unchanged)', async () => {
    const cookie = await freshCookie();
    const { contentType, entry } = await setUpDraftEntry(cookie);

    const viaSlug = await SELF.fetch(`https://example.com/api/v1/public/${contentType.slug}/${entry.slug}`);
    const viaFake = await SELF.fetch(`https://example.com/api/v1/public/${contentType.slug}/does-not-exist`);
    expect(viaSlug.status).toBe(404);
    expect(viaFake.status).toBe(404);
    expect(await viaSlug.json()).toEqual(await viaFake.json());
  });

  it('generates a preview token and fetches the draft through the preview route', async () => {
    const cookie = await freshCookie();
    const { contentType, entry } = await setUpDraftEntry(cookie);

    const tokenRes = await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}/preview-token`, {
      headers: { Cookie: cookie },
    });
    expect(tokenRes.status).toBe(200);
    const { token, expiresAt } = await tokenRes.json<{ token: string; expiresAt: string }>();
    expect(typeof token).toBe('string');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const previewRes = await SELF.fetch(
      `https://example.com/api/v1/public/preview/${contentType.slug}/${entry.slug}?token=${encodeURIComponent(token)}`,
    );
    expect(previewRes.status).toBe(200);
    const previewed = await previewRes.json<{ id: string; status: string; data: { title: string } }>();
    expect(previewed.id).toBe(entry.id);
    expect(previewed.status).toBe('draft');
    expect(previewed.data.title).toBe('Unpublished');
  });

  it('rejects the preview route with no token, a garbage token, or a token for a different entry', async () => {
    const cookie = await freshCookie();
    const { contentType, entry } = await setUpDraftEntry(cookie);

    // `token` is a required query param — omitting it entirely fails request validation (400,
    // this project's standard shape for any missing/malformed input) before the handler's own
    // "no valid token for this entry" 404 logic ever runs. Either way nothing about the entry's
    // existence is revealed: a 400 here fires identically for a real or fake contentType/slug.
    const noToken = await SELF.fetch(`https://example.com/api/v1/public/preview/${contentType.slug}/${entry.slug}`);
    expect(noToken.status).toBe(400);

    const garbage = await SELF.fetch(
      `https://example.com/api/v1/public/preview/${contentType.slug}/${entry.slug}?token=not-a-real-token`,
    );
    expect(garbage.status).toBe(404);

    // A second entry's own valid token must not unlock this one.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const otherEntry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'other-post', status: 'draft', data: { title: 'Other' } }),
      })
    ).json<{ id: string }>();
    const { token: otherToken } = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries/${otherEntry.id}/preview-token`, {
        headers: { Cookie: cookie },
      })
    ).json<{ token: string }>();

    const wrongEntry = await SELF.fetch(
      `https://example.com/api/v1/public/preview/${contentType.slug}/${entry.slug}?token=${encodeURIComponent(otherToken)}`,
    );
    expect(wrongEntry.status).toBe(404);
  });

  it('404s a preview-token request for a nonexistent entry', async () => {
    const cookie = await freshCookie();
    const response = await SELF.fetch('https://example.com/api/v1/admin/entries/nonexistent-id/preview-token', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });

  it('the preview route also works for an already-published entry', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string; slug: string }>();
    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'live-post', status: 'published', data: { title: 'Live' } }),
      })
    ).json<{ id: string; slug: string }>();

    const { token } = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}/preview-token`, { headers: { Cookie: cookie } })
    ).json<{ token: string }>();

    const previewRes = await SELF.fetch(
      `https://example.com/api/v1/public/preview/${contentType.slug}/${entry.slug}?token=${encodeURIComponent(token)}`,
    );
    expect(previewRes.status).toBe(200);
    expect((await previewRes.json<{ status: string }>()).status).toBe('published');
  });
});
