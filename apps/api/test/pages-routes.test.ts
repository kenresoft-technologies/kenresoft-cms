import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Phase 3 of the schema-driven frontend work (docs/SITE_BUILDER.md §4.1/§13): admin Pages CRUD,
// block-tree validation, route-collision checks (both against other Pages and against
// content-type route patterns), and revision history/restore.
//
// Same @cloudflare/vitest-pool-workers isolatedStorage caveat documented in
// content-type-route-pattern.test.ts (docs/SITE_BUILDER.md §18): D1 — including session/user —
// resets between every `it()`, so each scenario group below does exactly one real sign-up and
// runs several assertions sequentially within that single test's body, keeping this file's
// total sign-ups (and therefore its /auth/* POST count) comfortably under AUTH_RATE_LIMITER's
// 10/60s budget.
async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test User',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

function createPage(headers: Record<string, string>, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/v1/admin/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function createContentType(headers: Record<string, string>, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/v1/admin/content-types', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const heroBlock = { id: 'hero-1', type: 'hero', config: { heading: 'Welcome' } };

describe('admin pages (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM page_revisions');
    await env.DB.exec('DELETE FROM pages');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('creates, fetches, lists, updates, and deletes a page, validating its block tree', async () => {
    const headers = await authedHeaders('pages-crud@example.test');

    const created = await (
      await createPage(headers, { route: '/about', title: 'About us', blocks: [heroBlock] })
    ).json<{ id: string; route: string; status: string; blocks: unknown[]; seo: unknown }>();
    expect(created.route).toBe('/about');
    expect(created.status).toBe('draft');
    expect(created.blocks).toEqual([heroBlock]);
    expect(created.seo).toBeNull();

    const fetched = await (
      await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, { headers: { Cookie: headers.Cookie! } })
    ).json<{ title: string }>();
    expect(fetched.title).toBe('About us');

    const list = await (
      await SELF.fetch('https://example.com/api/v1/admin/pages', { headers: { Cookie: headers.Cookie! } })
    ).json<{ id: string }[]>();
    expect(list.some((page) => page.id === created.id)).toBe(true);

    const invalidConfig = await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ blocks: [{ id: 'hero-1', type: 'hero', config: { heading: 123 } }] }),
    });
    expect(invalidConfig.status).toBe(400);

    const nestedUnderLeaf = await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        blocks: [{ id: 'hero-1', type: 'hero', config: {}, children: [{ id: 'spacer-1', type: 'spacer', config: {} }] }],
      }),
    });
    expect(nestedUnderLeaf.status).toBe(400);

    const updated = await (
      await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: 'About our company',
          status: 'published',
          blocks: [
            { id: 'columns-1', type: 'columns', config: { columnCount: 2 }, children: [heroBlock] },
          ],
        }),
      })
    ).json<{ title: string; status: string }>();
    expect(updated.title).toBe('About our company');
    expect(updated.status).toBe('published');

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: headers.Cookie! },
    });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, {
      headers: { Cookie: headers.Cookie! },
    });
    expect(afterDelete.status).toBe(404);
  });

  it('rejects route collisions between pages and content-type route patterns in both directions', async () => {
    const headers = await authedHeaders('pages-route-collision@example.test');

    await createContentType(headers, { name: 'Blog', slug: 'blog', routePattern: '/blog/{slug}' });

    // A literal page route that a content type's own routePattern would already match.
    const pageUnderPattern = await createPage(headers, { route: '/blog/hello', title: 'Hello', blocks: [] });
    expect(pageUnderPattern.status).toBe(400);

    // A page route with a different shape doesn't collide.
    const firstPage = await (
      await createPage(headers, { route: '/hello', title: 'Hello', blocks: [] })
    ).json<{ id: string; route: string }>();
    expect(firstPage.route).toBe('/hello');

    // Another page can't reuse the same route.
    const duplicateRoute = await createPage(headers, { route: '/hello', title: 'Duplicate', blocks: [] });
    expect(duplicateRoute.status).toBe(400);

    // The reverse direction: a new content-type routePattern that would swallow an existing
    // page's own literal route.
    const conflictingPattern = await createContentType(headers, {
      name: 'Catch All',
      slug: 'catch-all',
      routePattern: '/{slug}',
    });
    expect(conflictingPattern.status).toBe(400);

    // Re-saving the page's own unchanged route is not a collision with itself.
    const selfUpdate = await SELF.fetch(`https://example.com/api/v1/admin/pages/${firstPage.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ route: '/hello', title: 'Hello (renamed)' }),
    });
    expect(selfUpdate.status).toBe(200);
  });

  it('snapshots a revision on every write and restores a page to a past revision', async () => {
    const headers = await authedHeaders('pages-revisions@example.test');

    const created = await (
      await createPage(headers, { route: '/history', title: 'Original title', blocks: [heroBlock] })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'Updated title' }),
    });

    const revisions = await (
      await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}/revisions`, {
        headers: { Cookie: headers.Cookie! },
      })
    ).json<{ id: string; title: string }[]>();
    expect(revisions.length).toBe(2);
    const originalRevision = revisions.find((revision) => revision.title === 'Original title');
    expect(originalRevision).toBeTruthy();

    const restored = await (
      await SELF.fetch(`https://example.com/api/v1/admin/pages/${created.id}/revisions/${originalRevision!.id}/restore`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      })
    ).json<{ title: string }>();
    expect(restored.title).toBe('Original title');

    const missingRevision = await SELF.fetch(
      `https://example.com/api/v1/admin/pages/${created.id}/revisions/does-not-exist/restore`,
      { method: 'POST', headers, body: JSON.stringify({}) },
    );
    expect(missingRevision.status).toBe(404);
  });
});
