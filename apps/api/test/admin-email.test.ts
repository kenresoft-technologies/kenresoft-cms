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

    const bad = await SELF.fetch('http://localhost/api/v1/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Site', emailSenderName: 'Evil <x@y.z>' }),
    });
    expect(bad.status).toBe(400);
  });
});
