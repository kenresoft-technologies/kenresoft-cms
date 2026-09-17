import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const pdfBytes = new TextEncoder().encode('%PDF-1.4\nfake-but-signature-valid');

async function uploadPrivatePdf(cookie: string): Promise<{ id: string; visibility: string; contentType: string }> {
  const body = new FormData();
  body.set('file', new File([pdfBytes], 'private.pdf', { type: 'application/pdf' }));
  body.set('visibility', 'private');
  const response = await SELF.fetch('https://example.com/api/v1/admin/media', {
    method: 'POST',
    headers: { Cookie: cookie },
    body,
  });
  expect(response.status).toBe(201);
  return response.json();
}

describe('media visibility (Phase 5, real D1 + R2)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media_attachments');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('accepts a document upload only when visibility is private', async () => {
    const cookie = await authedCookie('media-vis-1@example.test');

    const publicAttempt = new FormData();
    publicAttempt.set('file', new File([pdfBytes], 'doc.pdf', { type: 'application/pdf' }));
    const publicResponse = await SELF.fetch('https://example.com/api/v1/admin/media', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: publicAttempt,
    });
    expect(publicResponse.status).toBe(400);

    const created = await uploadPrivatePdf(cookie);
    expect(created.visibility).toBe('private');
    expect(created.contentType).toBe('application/pdf');
  });

  it('excludes a private asset from the default admin Media Library listing', async () => {
    const cookie = await authedCookie('media-vis-2@example.test');
    await uploadPrivatePdf(cookie);

    const publicUpload = new FormData();
    publicUpload.set('file', new File([pngBytes(4, 4)], 'p.png', { type: 'image/png' }));
    await SELF.fetch('https://example.com/api/v1/admin/media', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: publicUpload,
    });

    const list = await (
      await SELF.fetch('https://example.com/api/v1/admin/media', { headers: { Cookie: cookie } })
    ).json<{ visibility: string }[]>();
    expect(list.every((item) => item.visibility === 'public')).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it('never exposes a private asset through the public metadata or file routes, 404ing identically to a nonexistent id', async () => {
    const cookie = await authedCookie('media-vis-3@example.test');
    const created = await uploadPrivatePdf(cookie);

    const metadataResponse = await SELF.fetch(`https://example.com/api/v1/public/media/${created.id}`);
    const fileResponse = await SELF.fetch(`https://example.com/api/v1/public/media/${created.id}/file`);
    const nonexistentResponse = await SELF.fetch('https://example.com/api/v1/public/media/does-not-exist');

    expect(metadataResponse.status).toBe(404);
    expect(fileResponse.status).toBe(404);
    expect(await metadataResponse.json()).toEqual(await nonexistentResponse.json());
  });

  it('rejects switching a document asset back to public via PATCH', async () => {
    const cookie = await authedCookie('media-vis-4@example.test');
    const created = await uploadPrivatePdf(cookie);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/media/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'public' }),
    });
    expect(response.status).toBe(400);
  });
});
