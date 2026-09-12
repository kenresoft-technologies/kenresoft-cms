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
): Promise<Response> {
  return SELF.fetch('https://example.com/api/v1/admin/content-types', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// Phase 2 of the schema-driven frontend work (docs/SITE_BUILDER.md §14 decision #2, resolved):
// content_types.routePattern supports exactly one required "{slug}" parameter, validated for
// shape, reserved-path collision, and uniqueness among content types.
//
// @cloudflare/vitest-pool-workers resets D1 (and therefore the session/user tables) to a fresh
// isolated snapshot BETWEEN every `it()` by default — a cookie obtained in one test is not
// valid in the next one, so each scenario group below does exactly one real sign-up and
// exercises several assertions within that single test's body (D1 state IS shared across
// requests within one test), rather than one `it()` per assertion. This also keeps this file
// comfortably under AUTH_RATE_LIMITER's 10 POST/60s budget (which — unlike D1 — does persist
// across every `it()` in a file, confirmed by this project's own commerce-customer-auth test
// files): 4 sign-ups total (8 POSTs) across the whole file, not ~18.
describe('content type route patterns (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('accepts valid patterns, defaults to null when omitted, and round-trips through get/list', async () => {
    const headers = await authedHeaders('route-valid@example.test');

    const omitted = await (
      await createContentType(headers, { name: 'Untitled', slug: 'untitled' })
    ).json<{ routePattern: unknown }>();
    expect(omitted.routePattern).toBeNull();

    const created = await (
      await createContentType(headers, { name: 'Blog Post', slug: 'blog-post', routePattern: '/blog/{slug}' })
    ).json<{ id: string; routePattern: string | null }>();
    expect(created.routePattern).toBe('/blog/{slug}');

    const fetched = await (
      await SELF.fetch(`https://example.com/api/v1/admin/content-types/${created.id}`, {
        headers: { Cookie: headers.Cookie! },
      })
    ).json<{ routePattern: string | null }>();
    expect(fetched.routePattern).toBe('/blog/{slug}');

    const rootLevel = await (
      await createContentType(headers, { name: 'Page', slug: 'page', routePattern: '/{slug}' })
    ).json<{ routePattern: string | null }>();
    expect(rootLevel.routePattern).toBe('/{slug}');
  });

  it('rejects every disallowed route pattern shape and every reserved first segment', async () => {
    const headers = await authedHeaders('route-invalid@example.test');

    const invalidShapes = [
      'blog/{slug}', // missing leading slash
      '/blog', // no {slug} parameter at all
      '/blog/{slug}/{slug}', // two {slug} parameters
      '/blog/{slug}/comments', // {slug} not in the final position
      '/blog/*', // a wildcard, not supported in v1
      '/blog/{id}/{slug}', // a second, differently-named parameter, not supported in v1
      '/Blog/{slug}', // an uppercase literal segment
      '/blog/{slug}/', // a trailing slash after the parameter
    ];
    for (const routePattern of invalidShapes) {
      const res = await createContentType(headers, { name: 'Blog Post', slug: 'blog-post', routePattern });
      expect(res.status, `expected 400 for pattern ${JSON.stringify(routePattern)}`).toBe(400);
    }

    for (const routePattern of ['/api/{slug}', '/admin/{slug}']) {
      const res = await createContentType(headers, { name: 'Blog Post', slug: 'blog-post', routePattern });
      expect(res.status, `expected 400 for reserved pattern ${routePattern}`).toBe(400);
    }
  });

  it('rejects duplicate route patterns on create and update, but allows re-saving one\'s own', async () => {
    const headers = await authedHeaders('route-collision@example.test');

    await createContentType(headers, { name: 'Blog Post', slug: 'blog-post', routePattern: '/blog/{slug}' });

    const secondCreate = await createContentType(headers, {
      name: 'Blog Post Two',
      slug: 'blog-post-two',
      routePattern: '/blog/{slug}',
    });
    expect(secondCreate.status).toBe(400);

    const other = await (
      await createContentType(headers, { name: 'News', slug: 'news' })
    ).json<{ id: string }>();
    const updateCollision = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${other.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ routePattern: '/blog/{slug}' }),
    });
    expect(updateCollision.status).toBe(400);

    const blogPost = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', { headers: { Cookie: headers.Cookie! } })
    ).json<{ id: string; slug: string }[]>();
    const blogPostId = blogPost.find((ct) => ct.slug === 'blog-post')!.id;
    const selfUpdate = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${blogPostId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Blog Post (renamed)', routePattern: '/blog/{slug}' }),
    });
    expect(selfUpdate.status).toBe(200);
  });

  it('clearing a route pattern (setting it to null) frees it for another content type to use', async () => {
    const headers = await authedHeaders('route-clear@example.test');

    const created = await (
      await createContentType(headers, { name: 'Blog Post', slug: 'blog-post', routePattern: '/blog/{slug}' })
    ).json<{ id: string }>();

    const clearRes = await SELF.fetch(`https://example.com/api/v1/admin/content-types/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ routePattern: null }),
    });
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json<{ routePattern: unknown }>()).routePattern).toBeNull();

    const reuse = await createContentType(headers, {
      name: 'News',
      slug: 'news',
      routePattern: '/blog/{slug}',
    });
    expect(reuse.status).toBe(201);
  });
});

describe('public route-patterns listing (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('returns an empty array when no content type has a route pattern (no session required)', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/public/route-patterns');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('lists only content types with a non-null route pattern, sorted by content-type slug', async () => {
    const headers = await authedHeaders('route-public-list@example.test');
    await createContentType(headers, { name: 'Team', slug: 'team', routePattern: '/team/{slug}' });
    await createContentType(headers, { name: 'Blog Post', slug: 'blog-post', routePattern: '/blog/{slug}' });
    await createContentType(headers, { name: 'Untitled', slug: 'untitled' });

    const res = await SELF.fetch('https://example.com/api/v1/public/route-patterns');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { contentTypeSlug: 'blog-post', routePattern: '/blog/{slug}' },
      { contentTypeSlug: 'team', routePattern: '/team/{slug}' },
    ]);
  });
});
