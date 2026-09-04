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

// A byte-valid PNG header (signature + IHDR) — enough for the route's sniffImage validation
// and metadata extraction; IDAT/IEND are omitted since nothing in this path decodes pixels.
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe('media routes (real D1 + R2)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects every media route without a session', async () => {
    const responses = await Promise.all([
      SELF.fetch('https://example.com/api/v1/admin/media'),
      SELF.fetch('https://example.com/api/v1/admin/media', { method: 'POST' }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it('uploads, lists, serves, and deletes a PNG', async () => {
    const cookie = await authedCookie('media-1@example.test');

    const form = new FormData();
    form.set('file', new File([pngBytes(256, 128)], 'photo.png', { type: 'image/png' }));
    form.set('altText', 'A test photo');

    const uploadRes = await SELF.fetch('https://example.com/api/v1/admin/media', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const uploaded = await uploadRes.json<{
      id: string;
      contentType: string;
      width: number;
      height: number;
      altText: string;
    }>();
    expect(uploaded).toMatchObject({
      contentType: 'image/png',
      width: 256,
      height: 128,
      altText: 'A test photo',
    });

    const listRes = await SELF.fetch('https://example.com/api/v1/admin/media', {
      headers: { Cookie: cookie },
    });
    expect(await listRes.json()).toEqual([uploaded]);

    const fileRes = await SELF.fetch(`https://example.com/api/v1/admin/media/${uploaded.id}/file`, {
      headers: { Cookie: cookie },
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toBe('image/png');
    expect((await fileRes.arrayBuffer()).byteLength).toBe(24);

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/media/${uploaded.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const afterDeleteRes = await SELF.fetch(
      `https://example.com/api/v1/admin/media/${uploaded.id}/file`,
      { headers: { Cookie: cookie } },
    );
    expect(afterDeleteRes.status).toBe(404);
  });

  it('rejects a file whose bytes do not match any supported image signature', async () => {
    const cookie = await authedCookie('media-2@example.test');

    const form = new FormData();
    form.set(
      'file',
      new File([new TextEncoder().encode('not an image')], 'fake.png', { type: 'image/png' }),
    );

    const response = await SELF.fetch('https://example.com/api/v1/admin/media', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it('404s deleting a non-existent media item', async () => {
    const cookie = await authedCookie('media-3@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/media/does-not-exist', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });
});
