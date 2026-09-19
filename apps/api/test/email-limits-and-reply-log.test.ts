import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { signUpVerifiedAndGetCookie } from './helpers/auth';

const pdfBytes = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return bytes;
};

describe('attachment size limits and reply log', () => {
  it('rejects over-limit attachments, and logs attachment metadata (not the binary) on a reply without touching R2', async () => {
    const cookie = await signUpVerifiedAndGetCookie('replylog@example.test', {
      password: 'correct horse battery staple',
      name: 'Reply Log',
    });
    clearTestEmails();

    // Over the total cap -> 400, nothing sent.
    const big = new FormData();
    big.set('to', 'a@example.test');
    big.set('subject', 'Big');
    big.set('bodyHtml', '<p>x</p>');
    big.append('files', new File([pdfBytes(4 * 1024 * 1024)], 'big.pdf'));
    const bigRes = await SELF.fetch('http://localhost/api/v1/admin/email/send', {
      method: 'POST',
      headers: { cookie },
      body: big,
    });
    expect(bigRes.status).toBe(400);
    expect(getTestEmails().filter((m) => m.subject === 'Big')).toHaveLength(0);

    // A form + submission to reply to.
    const jsonHeaders = { cookie, 'content-type': 'application/json' };
    const formRes = await SELF.fetch('http://localhost/api/v1/admin/forms', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Contact', slug: 'contact', fields: [] }),
    });
    const form = await formRes.json<{ id: string }>();
    const submitRes = await SELF.fetch('http://localhost/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': 'reply-log-test' },
      body: JSON.stringify({}),
    });
    const submission = await submitRes.json<{ id: string }>();
    const before = (await env.MEDIA_BUCKET.list()).objects.length;

    const reply = new FormData();
    reply.set('to', 'jane@example.com');
    reply.set('subject', 'Re: Attached');
    reply.set('bodyHtml', '<p>See attached</p>');
    reply.append('files', new File([pdfBytes(19)], 'quote.pdf'));
    const replyRes = await SELF.fetch(
      `http://localhost/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
      { method: 'POST', headers: { cookie }, body: reply },
    );
    expect(replyRes.status).toBe(201);
    const created = await replyRes.json<{ attachments: unknown[] }>();
    expect(created.attachments).toEqual([
      { filename: 'quote.pdf', contentType: 'application/pdf', size: 19, source: 'upload' },
    ]);
    expect(getTestEmails().filter((m) => m.subject === 'Re: Attached')[0]!.attachments).toHaveLength(1);

    const listRes = await SELF.fetch(
      `http://localhost/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
      { headers: { cookie } },
    );
    const replies = await listRes.json<{ attachments: { filename: string; size: number }[] }[]>();
    expect(replies[0]!.attachments[0]).toMatchObject({ filename: 'quote.pdf', size: 19 });

    // Attachments live only in request memory — nothing was staged in R2, so nothing to orphan.
    expect((await env.MEDIA_BUCKET.list()).objects.length).toBe(before);
  });
});

describe('Media Library attachments', () => {
  it('reads a private media file server-side, records its mediaId, and leaves the media untouched', async () => {
    const cookie = await signUpVerifiedAndGetCookie('mediaattach@example.test', {
      password: 'correct horse battery staple',
      name: 'Media Attach',
    });
    clearTestEmails();
    const upload = new FormData();
    upload.set('file', new File([pdfBytes(64)], 'private.pdf'));
    upload.set('visibility', 'private');
    const uploadRes = await SELF.fetch('http://localhost/api/v1/admin/media', {
      method: 'POST',
      headers: { cookie },
      body: upload,
    });
    expect(uploadRes.status).toBe(201);
    const media = await uploadRes.json<{ id: string }>();
    const before = (await env.MEDIA_BUCKET.list()).objects.length;

    const form = new FormData();
    form.set('to', 'a@example.test');
    form.set('subject', 'FromMedia');
    form.set('bodyHtml', '<p>x</p>');
    form.append('mediaIds', media.id);
    const res = await SELF.fetch('http://localhost/api/v1/admin/email/send', {
      method: 'POST',
      headers: { cookie },
      body: form,
    });
    expect(res.status).toBe(200);
    const sent = getTestEmails().filter((m) => m.subject === 'FromMedia')[0]!;
    expect(sent.attachments?.[0]).toMatchObject({ filename: 'private.pdf', mediaId: media.id });
    expect((await env.MEDIA_BUCKET.list()).objects.length).toBe(before);

    // A media id that doesn't exist is a clean 400, not a crash.
    const bad = new FormData();
    bad.set('to', 'a@example.test');
    bad.set('subject', 'Bad');
    bad.set('bodyHtml', '<p>x</p>');
    bad.append('mediaIds', 'does-not-exist');
    const badRes = await SELF.fetch('http://localhost/api/v1/admin/email/send', {
      method: 'POST',
      headers: { cookie },
      body: bad,
    });
    expect(badRes.status).toBe(400);
  });
});
