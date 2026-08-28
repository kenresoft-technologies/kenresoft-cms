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

// A byte-valid PNG header (signature + IHDR) — enough for the upload route's sniffImage
// validation, matching test/media-routes.test.ts's fixture.
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

async function uploadMedia(cookie: string): Promise<{ id: string }> {
  const form = new FormData();
  form.set('file', new File([pngBytes(64, 32)], 'photo.png', { type: 'image/png' }));

  const response = await SELF.fetch('https://example.com/api/v1/admin/media', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  return response.json<{ id: string }>();
}

describe('public media route (real D1 + R2)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('serves an uploaded file with no session required', async () => {
    const cookie = await authedCookie('public-media-1@pathvera.test');
    const uploaded = await uploadMedia(cookie);

    const response = await SELF.fetch(`https://example.com/api/v1/public/media/${uploaded.id}/file`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await response.arrayBuffer()).byteLength).toBe(24);
  });

  it('404s for a media id that does not exist', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/public/media/does-not-exist/file');
    expect(response.status).toBe(404);
  });

  it('serves a cached response on a repeat GET, even after the underlying object is removed', async () => {
    const cookie = await authedCookie('public-media-2@pathvera.test');
    const uploaded = await uploadMedia(cookie);

    const first = await SELF.fetch(`https://example.com/api/v1/public/media/${uploaded.id}/file`);
    expect(first.status).toBe(200);
    // Consuming the body isn't optional cleanup here — the route's cache middleware writes to
    // the Cache API via ctx.waitUntil() (fire-and-forget, matching the identical pattern in
    // publicContentRoute), and leaving this response's body unread left that background write
    // (and, transitively, the next SELF.fetch call below) hanging indefinitely under
    // @cloudflare/vitest-pool-workers — confirmed by bisecting per-test with `vitest -t`.
    await first.arrayBuffer();

    // Bypasses the admin DELETE route entirely, so no cache invalidation runs — proves the
    // second fetch below is served from cache, not recomputed from R2.
    await env.DB.exec(`DELETE FROM media WHERE id = '${uploaded.id}'`);

    const second = await SELF.fetch(`https://example.com/api/v1/public/media/${uploaded.id}/file`);
    expect(second.status).toBe(200);
    expect((await second.arrayBuffer()).byteLength).toBe(24);
  });

  it('invalidates the cache when the file is deleted via the admin API', async () => {
    const cookie = await authedCookie('public-media-3@pathvera.test');
    const uploaded = await uploadMedia(cookie);

    const first = await SELF.fetch(`https://example.com/api/v1/public/media/${uploaded.id}/file`);
    expect(first.status).toBe(200);
    await first.arrayBuffer(); // see the previous test for why this matters here

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/media/${uploaded.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const second = await SELF.fetch(`https://example.com/api/v1/public/media/${uploaded.id}/file`);
    expect(second.status).toBe(404);
  });
});
