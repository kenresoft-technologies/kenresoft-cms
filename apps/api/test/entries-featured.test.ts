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
): Promise<{ id: string }> {
  const res = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
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
): Promise<{ id: string; featured: boolean }> {
  const res = await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentTypeId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

// A first-class "feature this" flag on Entry, independent of any content-type-specific field —
// see packages/database/schema/entries.ts's own comment for why. Covers the admin CRUD/list
// filter, the public API filter (and its own cache-key isolation, since the public route's edge
// cache is keyed on the full query string, not just the path), and that omitting it defaults to
// false rather than requiring every caller to pass it explicitly.
describe('entry featured flag (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('defaults to false, can be set on create, and toggled on update', async () => {
    const headers = await authedHeaders('featured-crud@example.test');
    const contentType = await createContentType(headers, { name: 'Post', slug: 'post' });

    const created = await createEntry(headers, contentType.id, { slug: 'a', data: {} });
    expect(created.featured).toBe(false);

    const createdFeatured = await createEntry(headers, contentType.id, { slug: 'b', data: {}, featured: true });
    expect(createdFeatured.featured).toBe(true);

    const patched = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ featured: true }),
      })
    ).json<{ featured: boolean; slug: string }>();
    expect(patched.featured).toBe(true);
    // A PATCH that omits featured entirely must never silently reset it back to false — the
    // exact class of bug the codebase's own hand-written-update-schema convention exists to
    // prevent (packages/contracts/schemas/entries.ts).
    const unrelatedPatch = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ slug: 'a-renamed' }),
      })
    ).json<{ featured: boolean }>();
    expect(unrelatedPatch.featured).toBe(true);
  });

  it('filters the admin list by ?featured=true', async () => {
    const headers = await authedHeaders('featured-admin-list@example.test');
    const contentType = await createContentType(headers, { name: 'Post', slug: 'post' });
    await createEntry(headers, contentType.id, { slug: 'a', data: {}, featured: true });
    await createEntry(headers, contentType.id, { slug: 'b', data: {}, featured: false });

    const all = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        headers: { Cookie: headers.Cookie! },
      })
    ).json<{ slug: string }[]>();
    expect(all.map((e) => e.slug).sort()).toEqual(['a', 'b']);

    const featuredOnly = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}&featured=true`, {
        headers: { Cookie: headers.Cookie! },
      })
    ).json<{ slug: string }[]>();
    expect(featuredOnly.map((e) => e.slug)).toEqual(['a']);
  });

  it('filters the public list by ?featured=true, with the unfiltered list served from a separate cache entry', async () => {
    const headers = await authedHeaders('featured-public-list@example.test');
    const contentType = await createContentType(headers, { name: 'Post', slug: 'post-public' });
    await createEntry(headers, contentType.id, { slug: 'a', status: 'published', data: {}, featured: true });
    await createEntry(headers, contentType.id, { slug: 'b', status: 'published', data: {}, featured: false });

    const all = await (
      await SELF.fetch('https://example.com/api/v1/public/post-public')
    ).json<{ slug: string; featured: boolean }[]>();
    expect(all.map((e) => e.slug).sort()).toEqual(['a', 'b']);

    const featuredOnly = await (
      await SELF.fetch('https://example.com/api/v1/public/post-public?featured=true')
    ).json<{ slug: string; featured: boolean }[]>();
    expect(featuredOnly).toEqual([expect.objectContaining({ slug: 'a', featured: true })]);

    // Re-fetching the unfiltered list after the filtered one must still return both entries —
    // proves the two requests didn't collide on the same edge-cache entry.
    const allAgain = await (
      await SELF.fetch('https://example.com/api/v1/public/post-public')
    ).json<{ slug: string }[]>();
    expect(allAgain.map((e) => e.slug).sort()).toEqual(['a', 'b']);
  });
});
