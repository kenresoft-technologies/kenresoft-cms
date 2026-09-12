import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Phase 3 of the schema-driven frontend work (docs/SITE_BUILDER.md §4.2/§7): the public,
// unauthenticated Pages routes reuse routes/public/content.ts's exact draft-is-nonexistent
// convention — a draft page 404s identically to a route nobody has ever created.
async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test User',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

describe('public pages (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM page_revisions');
    await env.DB.exec('DELETE FROM pages');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('lists only published pages and resolves one by route, 404ing a draft exactly like a nonexistent route', async () => {
    const headers = await authedHeaders('public-pages@example.test');

    const draft = await (
      await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ route: '/drafted', title: 'Not yet', blocks: [] }),
      })
    ).json<{ id: string; route: string }>();

    const published = await (
      await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ route: '/about', title: 'About us', status: 'published', blocks: [] }),
      })
    ).json<{ id: string; route: string }>();

    const list = await (await SELF.fetch('https://example.com/api/v1/public/pages')).json<
      { id: string; route: string; title: string }[]
    >();
    expect(list).toEqual([{ id: published.id, route: '/about', title: 'About us' }]);

    const resolvedPublished = await SELF.fetch('https://example.com/api/v1/public/pages/by-route?route=/about');
    expect(resolvedPublished.status).toBe(200);
    expect((await resolvedPublished.json<{ title: string }>()).title).toBe('About us');

    const resolvedDraft = await SELF.fetch(`https://example.com/api/v1/public/pages/by-route?route=${draft.route}`);
    expect(resolvedDraft.status).toBe(404);

    const resolvedNonexistent = await SELF.fetch('https://example.com/api/v1/public/pages/by-route?route=/does-not-exist');
    expect(resolvedNonexistent.status).toBe(404);
    expect(await resolvedDraft.json()).toEqual(await resolvedNonexistent.json());
  });

  it('returns an empty list when no page is published', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/public/pages');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
