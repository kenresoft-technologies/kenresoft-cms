import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { signUpVerifiedAndGetCookie } from './helpers/auth';

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});

describe('admin email sending identity', () => {
  it('sends from EMAIL_FROM by default, then from the configured sender, with Reply-To as the staff email', async () => {
    const cookie = await signUpVerifiedAndGetCookie('mailer@example.test', {
      password: 'correct horse battery staple',
      name: 'Mailer',
    });
    clearTestEmails();

    const first = await SELF.fetch(
      'http://localhost/api/v1/admin/email/send',
      json(cookie, { to: 'a@example.test', subject: 'Hi', bodyHtml: '<p>Hello</p>' }),
    );
    expect(first.status).toBe(200);
    expect(getTestEmails().at(-1)?.from).toBeUndefined();
    expect(getTestEmails().at(-1)?.replyTo).toBe('mailer@example.test');

    const put = await SELF.fetch('http://localhost/api/v1/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Site', emailSenderName: 'Acme Support', emailSenderEmail: 'hello@acme.test' }),
    });
    expect(put.status).toBe(200);

    const second = await SELF.fetch(
      'http://localhost/api/v1/admin/email/send',
      json(cookie, { to: 'b@example.test', subject: 'Yo', bodyHtml: '<p>Hi</p>', replyTo: 'me@zoho.test' }),
    );
    expect(second.status).toBe(200);
    const sent = getTestEmails().at(-1);
    expect(sent?.from).toBe('Acme Support <hello@acme.test>');
    expect(sent?.replyTo).toBe('me@zoho.test');

    // No override: Reply-To defaults to the configured sender address, not the staff member's.
    const third = await SELF.fetch(
      'http://localhost/api/v1/admin/email/send',
      json(cookie, { to: 'c@example.test', subject: 'Def', bodyHtml: '<p>Hi</p>' }),
    );
    expect(third.status).toBe(200);
    expect(getTestEmails().at(-1)?.replyTo).toBe('hello@acme.test');

    const bad = await SELF.fetch('http://localhost/api/v1/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Site', emailSenderName: 'Evil <x@y.z>' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('admin email attachments', () => {
  it('attaches a verified file, rejects unsupported bytes, and enforces the file-count limit', async () => {
    const cookie = await signUpVerifiedAndGetCookie('attacher@example.test', {
      password: 'correct horse battery staple',
      name: 'Attacher',
    });
    clearTestEmails();
    const send = (form: FormData) =>
      SELF.fetch('http://localhost/api/v1/admin/email/send', { method: 'POST', headers: { cookie }, body: form });
    const base = () => {
      const form = new FormData();
      form.set('to', 'a@example.test');
      form.set('subject', 'Docs');
      form.set('bodyHtml', '<p>See attached</p>');
      return form;
    };

    const pdf = new File([new TextEncoder().encode('%PDF-1.4 fake body')], 'report.pdf', { type: 'text/plain' });
    const ok = base();
    ok.append('files', pdf);
    expect((await send(ok)).status).toBe(200);
    const sent = getTestEmails().at(-1);
    expect(sent?.attachments?.[0]?.filename).toBe('report.pdf');
    expect(sent?.attachments?.[0]?.contentType).toBe('application/pdf');
    expect(sent?.html).toContain('See attached');
    expect(sent?.text).toContain('See attached');

    const bad = base();
    bad.append('files', new File([new TextEncoder().encode('MZ not allowed')], 'evil.pdf', { type: 'application/pdf' }));
    const badRes = await send(bad);
    expect(badRes.status).toBe(400);

    const many = base();
    for (let i = 0; i < 11; i++) many.append('files', pdf);
    expect((await send(many)).status).toBe(400);

    const limits = await SELF.fetch('http://localhost/api/v1/admin/email/limits', { headers: { cookie } });
    expect((await limits.json<{ configured: boolean }>()).configured).toBe(true);
  });
});

describe('subject header-injection guard', () => {
  it('rejects a subject containing line breaks', async () => {
    const cookie = await signUpVerifiedAndGetCookie('crlf@example.test', {
      password: 'correct horse battery staple',
      name: 'Crlf',
    });
    clearTestEmails();
    const res = await SELF.fetch('http://localhost/api/v1/admin/email/send', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        to: 'a@example.test',
        subject: 'Hi' + String.fromCharCode(13, 10) + 'Bcc: victim@example.test',
        bodyHtml: '<p>x</p>',
      }),
    });
    expect(res.status).toBe(400);
    expect(getTestEmails()).toHaveLength(0);
  });

  it('rate limits sending per staff user', async () => {
    const cookie = await signUpVerifiedAndGetCookie('spammer@example.test', {
      password: 'correct horse battery staple',
      name: 'Spammer',
    });
    const send = () =>
      SELF.fetch(
        'http://localhost/api/v1/admin/email/send',
        json(cookie, { to: 'a@example.test', subject: 'Hi', bodyHtml: '<p>Hello</p>' }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await send()).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
