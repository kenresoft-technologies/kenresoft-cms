import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function createHeroType(cookie: string): Promise<{ id: string; slug: string }> {
  const response = await SELF.fetch('https://example.com/api/v1/admin/ui-content/types', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Hero',
      slug: 'hero',
      fields: [
        { name: 'heading', label: 'Heading', fieldType: 'text', required: true, config: {} },
        { name: 'subheading', label: 'Subheading', fieldType: 'text', required: false, config: {} },
      ],
    }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

describe('UI Content (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM ui_content_items');
    await env.DB.exec('DELETE FROM ui_content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('creates a type, creates an item validated against its fields, and fetches it publicly by type/slug', async () => {
    const cookie = await authedCookie('ui-content-owner@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const type = await createHeroType(cookie);

    const item = await (
      await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${type.id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'home-page-hero', data: { heading: 'Welcome' } }),
      })
    ).json<{ id: string; slug: string; enabled: boolean }>();
    expect(item.enabled).toBe(true);

    const publicList = await (await SELF.fetch('https://example.com/api/v1/public/ui-content/hero')).json<
      Array<{ slug: string; data: Record<string, unknown> }>
    >();
    expect(publicList).toHaveLength(1);
    expect(publicList[0]).toMatchObject({ slug: 'home-page-hero', data: { heading: 'Welcome' } });

    const publicItem = await (
      await SELF.fetch('https://example.com/api/v1/public/ui-content/hero/home-page-hero')
    ).json<{ slug: string; data: Record<string, unknown> }>();
    expect(publicItem).toMatchObject({ slug: 'home-page-hero', data: { heading: 'Welcome' } });
  });

  it("rejects an item whose data doesn't match its type's required fields", async () => {
    const cookie = await authedCookie('ui-content-validate@example.test');
    const type = await createHeroType(cookie);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${type.id}/items`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'missing-heading', data: {} }),
    });
    expect(response.status).toBe(400);
  });

  it('a disabled item 404s on the public API exactly like a nonexistent slug', async () => {
    const cookie = await authedCookie('ui-content-disabled@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const type = await createHeroType(cookie);

    const item = await (
      await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${type.id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'draft-hero', data: { heading: 'Shh' }, enabled: false }),
      })
    ).json<{ id: string }>();

    const disabledResponse = await SELF.fetch('https://example.com/api/v1/public/ui-content/hero/draft-hero');
    expect(disabledResponse.status).toBe(404);

    const nonexistentResponse = await SELF.fetch('https://example.com/api/v1/public/ui-content/hero/does-not-exist');
    expect(nonexistentResponse.status).toBe(404);
    expect(await disabledResponse.text()).toBe(await nonexistentResponse.text());

    // Enabling it makes it visible again.
    await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${type.id}/items/${item.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    const enabledResponse = await SELF.fetch('https://example.com/api/v1/public/ui-content/hero/draft-hero');
    expect(enabledResponse.status).toBe(200);
    // Body must be read — an unread ok response leaves this route's background
    // `cache.put()` (apps/api/src/routes/public/ui-content.ts) hanging indefinitely under
    // @cloudflare/vitest-pool-workers, the same documented gotcha public-media-routes.test.ts's
    // own comment already names.
    await enabledResponse.json();
  });

  it('rejects a duplicate item slug within the same type, but allows it across different types', async () => {
    const cookie = await authedCookie('ui-content-dup@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const heroType = await createHeroType(cookie);

    await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${heroType.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'shared-slug', data: { heading: 'One' } }),
    });
    const dup = await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${heroType.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'shared-slug', data: { heading: 'Two' } }),
    });
    expect(dup.status).toBe(400);

    const carouselType = await (
      await SELF.fetch('https://example.com/api/v1/admin/ui-content/types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Carousel', slug: 'carousel', fields: [] }),
      })
    ).json<{ id: string }>();
    const acrossTypes = await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${carouselType.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'shared-slug', data: {} }),
    });
    expect(acrossTypes.status).toBe(201);
  });

  it('deleting a type deletes every item under it', async () => {
    const cookie = await authedCookie('ui-content-cascade@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const type = await createHeroType(cookie);
    await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${type.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'x', data: { heading: 'X' } }),
    });

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/ui-content/types/${type.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM ui_content_items').all<{ count: number }>();
    expect(results[0]?.count).toBe(0);
  });

  it('rejects UI content type creation from an author, allows it from the owner', async () => {
    const ownerCookie = await authedCookie('ui-content-owner2@example.test');
    const authorCookie = await authedCookie('ui-content-author@example.test');
    const authorId = (
      await (await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: authorCookie } })).json<{
        user: { id: string };
      }>()
    ).user.id;
    await SELF.fetch(`https://example.com/api/v1/admin/users/${authorId}/role`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'author' }),
    });

    const rejected = await SELF.fetch('https://example.com/api/v1/admin/ui-content/types', {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', slug: 'x' }),
    });
    expect(rejected.status).toBe(403);

    const allowed = await SELF.fetch('https://example.com/api/v1/admin/ui-content/types', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', slug: 'x' }),
    });
    expect(allowed.status).toBe(201);
  });
});
