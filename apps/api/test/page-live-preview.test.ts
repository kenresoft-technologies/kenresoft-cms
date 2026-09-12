import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Phase 5 of the schema-driven frontend work (docs/SITE_BUILDER.md §1.3/§4.2/§20) — Page
// preview reuses preview-token.ts verbatim (the signing/verification pair is entirely
// id-agnostic despite its internal field being named `entryId`), mirroring
// live-preview.test.ts's own structure exactly, adapted for a Page's literal `route` instead of
// a content-type slug + entry slug pair.
async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

let cookieCounter = 0;
async function freshCookie(): Promise<string> {
  cookieCounter += 1;
  return authedCookie(`page-live-preview-${cookieCounter}@example.test`);
}

describe('Page Live Preview (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM page_revisions');
    await env.DB.exec('DELETE FROM pages');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  async function setUpDraftPage(cookie: string) {
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const page = await (
      await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ route: '/drafted', title: 'Unpublished', blocks: [] }),
      })
    ).json<{ id: string; route: string }>();
    return { page };
  }

  it('the normal public route 404s a draft page exactly like a nonexistent route (unchanged)', async () => {
    const cookie = await freshCookie();
    const { page } = await setUpDraftPage(cookie);

    const viaRoute = await SELF.fetch(`https://example.com/api/v1/public/pages/by-route?route=${page.route}`);
    const viaFake = await SELF.fetch('https://example.com/api/v1/public/pages/by-route?route=/does-not-exist');
    expect(viaRoute.status).toBe(404);
    expect(viaFake.status).toBe(404);
    expect(await viaRoute.json()).toEqual(await viaFake.json());
  });

  it('generates a preview token and fetches the draft page through the preview route', async () => {
    const cookie = await freshCookie();
    const { page } = await setUpDraftPage(cookie);

    const tokenRes = await SELF.fetch(`https://example.com/api/v1/admin/pages/${page.id}/preview-token`, {
      headers: { Cookie: cookie },
    });
    expect(tokenRes.status).toBe(200);
    const { token, expiresAt } = await tokenRes.json<{ token: string; expiresAt: string }>();
    expect(typeof token).toBe('string');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const previewRes = await SELF.fetch(
      `https://example.com/api/v1/public/preview/pages?route=${page.route}&token=${encodeURIComponent(token)}`,
    );
    expect(previewRes.status).toBe(200);
    const previewed = await previewRes.json<{ id: string; status: string; title: string }>();
    expect(previewed.id).toBe(page.id);
    expect(previewed.status).toBe('draft');
    expect(previewed.title).toBe('Unpublished');
  });

  it('rejects the preview route with no token, a garbage token, or a token for a different page', async () => {
    const cookie = await freshCookie();
    const { page } = await setUpDraftPage(cookie);

    const noToken = await SELF.fetch(`https://example.com/api/v1/public/preview/pages?route=${page.route}`);
    expect(noToken.status).toBe(400);

    const garbage = await SELF.fetch(
      `https://example.com/api/v1/public/preview/pages?route=${page.route}&token=not-a-real-token`,
    );
    expect(garbage.status).toBe(404);

    // A second page's own valid token must not unlock this one.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const otherPage = await (
      await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ route: '/other', title: 'Other', blocks: [] }),
      })
    ).json<{ id: string }>();
    const { token: otherToken } = await (
      await SELF.fetch(`https://example.com/api/v1/admin/pages/${otherPage.id}/preview-token`, {
        headers: { Cookie: cookie },
      })
    ).json<{ token: string }>();

    const wrongPage = await SELF.fetch(
      `https://example.com/api/v1/public/preview/pages?route=${page.route}&token=${encodeURIComponent(otherToken)}`,
    );
    expect(wrongPage.status).toBe(404);
  });

  it('404s a preview-token request for a nonexistent page', async () => {
    const cookie = await freshCookie();
    const response = await SELF.fetch('https://example.com/api/v1/admin/pages/nonexistent-id/preview-token', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });

  it('the preview route also works for an already-published page', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const page = await (
      await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ route: '/live', title: 'Live', status: 'published', blocks: [] }),
      })
    ).json<{ id: string; route: string }>();

    const { token } = await (
      await SELF.fetch(`https://example.com/api/v1/admin/pages/${page.id}/preview-token`, { headers: { Cookie: cookie } })
    ).json<{ token: string }>();

    const previewRes = await SELF.fetch(
      `https://example.com/api/v1/public/preview/pages?route=${page.route}&token=${encodeURIComponent(token)}`,
    );
    expect(previewRes.status).toBe(200);
    expect((await previewRes.json<{ status: string }>()).status).toBe('published');
  });
});
