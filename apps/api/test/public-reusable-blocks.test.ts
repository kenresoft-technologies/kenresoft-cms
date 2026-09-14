import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Phase 7 of the schema-driven frontend work (docs/SITE_BUILDER.md): a reusableBlockRef block
// node only stores a `reusableBlockId` — rendering it requires fetching the referenced block's
// own type/config live, at render time (the live-reference model, never copied), so this public
// route exists purely to support that. No draft/published concept for reusable blocks — every
// created one is addressable, same trust model as public media.
async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test User',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

describe('public reusable blocks (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM reusable_blocks');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('serves a reusable block by id, unauthenticated, and 404s an unknown id', async () => {
    const headers = await authedHeaders('public-reusable-block@example.test');

    const created = await (
      await SELF.fetch('https://example.com/api/v1/admin/reusable-blocks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Shared CTA', type: 'cta', config: { heading: 'Sign up' } }),
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(`https://example.com/api/v1/public/reusable-blocks/${created.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: created.id,
      name: 'Shared CTA',
      type: 'cta',
      config: { heading: 'Sign up' },
    });

    const missing = await SELF.fetch('https://example.com/api/v1/public/reusable-blocks/nonexistent');
    expect(missing.status).toBe(404);
    await missing.text(); // see public-media-routes.test.ts for why an unread body matters here
  });

  it('reflects an update immediately (edge cache invalidated on write)', async () => {
    const headers = await authedHeaders('public-reusable-block-update@example.test');

    const created = await (
      await SELF.fetch('https://example.com/api/v1/admin/reusable-blocks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Shared CTA', type: 'cta', config: { heading: 'Original' } }),
      })
    ).json<{ id: string }>();

    const populate = await SELF.fetch(`https://example.com/api/v1/public/reusable-blocks/${created.id}`);
    await populate.text(); // see public-media-routes.test.ts for why an unread body matters here

    await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ config: { heading: 'Updated' } }),
    });

    const response = await SELF.fetch(`https://example.com/api/v1/public/reusable-blocks/${created.id}`);
    expect((await response.json<{ config: { heading: string } }>()).config.heading).toBe('Updated');
  });
});
