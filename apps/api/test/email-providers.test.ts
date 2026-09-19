import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAttachmentLimits } from '../src/lib/email/attachments';
import { createCloudflareEmailSender } from '../src/lib/email/cloudflare';
import { createResendEmailSender, toBase64 } from '../src/lib/email/resend';
import type { Bindings } from '../src/lib/env';

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 255, 0]);
const message = {
  to: 'to@example.test',
  subject: 'Subject',
  text: 'plain',
  html: '<p>html</p>',
  replyTo: 'staff@example.test',
  from: 'Acme <hello@acme.test>',
  attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: bytes }],
};

afterEach(() => vi.unstubAllGlobals());

describe('Resend provider payload', () => {
  it('sends base64 attachments with content_type, the override From, HTML and text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'noreply@acme.test' } as unknown as Bindings;

    await createResendEmailSender(env).send(message);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('Acme <hello@acme.test>');
    expect(body.reply_to).toBe('staff@example.test');
    expect(body.html).toBe('<p>html</p>');
    expect(body.text).toBe('plain');
    expect(body.attachments).toEqual([
      { filename: 'a.pdf', content: btoa(String.fromCharCode(...bytes)), content_type: 'application/pdf' },
    ]);
  });

  it('falls back to EMAIL_FROM and omits attachments when there are none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'noreply@acme.test' } as unknown as Bindings;

    await createResendEmailSender(env).send({ to: 'x@example.test', subject: 's', text: 't' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.from).toBe('noreply@acme.test');
    expect(body.attachments).toBeUndefined();
  });

  it('base64-encodes multi-slice payloads identically to a one-shot encode', () => {
    const large = new Uint8Array(3 * 0x2000 * 2 + 5).map((_, i) => (i * 31) % 256);
    let reference = '';
    for (const b of large) reference += String.fromCharCode(b);
    expect(toBase64(large)).toBe(btoa(reference));
  });

  it('surfaces a provider rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('too big', { status: 422 })));
    const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'noreply@acme.test' } as unknown as Bindings;
    await expect(createResendEmailSender(env).send(message)).rejects.toThrow(/422/);
  });
});

describe('Cloudflare Email Service provider payload', () => {
  it('maps attachments to the send_email binding shape with the override From', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = { EMAIL: { send }, EMAIL_FROM: 'noreply@acme.test' } as unknown as Bindings;

    await createCloudflareEmailSender(env).send(message);

    expect(send).toHaveBeenCalledWith({
      from: 'Acme <hello@acme.test>',
      to: 'to@example.test',
      subject: 'Subject',
      text: 'plain',
      html: '<p>html</p>',
      reply_to: 'staff@example.test',
      attachments: [{ disposition: 'attachment', filename: 'a.pdf', type: 'application/pdf', content: bytes }],
    });
  });

  it('falls back to EMAIL_FROM and omits attachments when there are none', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = { EMAIL: { send }, EMAIL_FROM: 'noreply@acme.test' } as unknown as Bindings;
    await createCloudflareEmailSender(env).send({ to: 'x@example.test', subject: 's', text: 't' });
    const arg = send.mock.calls[0]![0];
    expect(arg.from).toBe('noreply@acme.test');
    expect('attachments' in arg).toBe(false);
  });
});

describe('attachment limits per provider', () => {
  it('uses the small Cloudflare cap (5 MiB message limit) and the larger Resend cap', () => {
    const MB = 1024 * 1024;
    expect(getAttachmentLimits({ EMAIL_PROVIDER: 'cloudflare' } as Bindings).maxTotalBytes).toBe(3 * MB);
    expect(getAttachmentLimits({ EMAIL_PROVIDER: 'resend' } as Bindings).maxTotalBytes).toBe(15 * MB);
  });
});
