import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { signUpVerifiedAndGetCookie } from './helpers/auth';

const BASE = 'http://localhost';
const PASSWORD = 'correct horse battery staple';

const TEMPLATE =
  '<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body>' +
  '<table width="600" align="center" style="background-color:#ffffff"><tr><td style="padding:20px">' +
  '<h1>Big news</h1><img src="https://cdn.example.com/logo.png" alt="Logo" width="120">' +
  '<a href="https://example.com/go" style="background-color:#7c3aed;color:#ffffff">Read more</a>' +
  '<script>alert(1)</script></td><td>Second column</td></tr></table></body></html>';

function send(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return SELF.fetch(`${BASE}/api/v1/admin/email/send`, { method: 'POST', headers: { cookie }, body: form });
}

describe('Design HTML emails', () => {
  it('sends a designed template with layout preserved for admins, and refuses editors', async () => {
    const owner = await signUpVerifiedAndGetCookie('design-owner@example.test', { password: PASSWORD, name: 'Owner' });
    const editor = await signUpVerifiedAndGetCookie('design-editor@example.test', { password: PASSWORD, name: 'Editor' });
    clearTestEmails();

    // An editor may not send designed HTML.
    const denied = await send(editor, { to: 'a@example.test', subject: 'Denied', bodyHtml: TEMPLATE, designHtml: 'true' });
    expect(denied.status).toBe(403);
    expect(getTestEmails().filter((m) => m.subject === 'Denied')).toHaveLength(0);

    // The owner can: layout kept, dangerous content removed, plain-text fallback produced.
    const ok = await send(owner, { to: 'a@example.test', subject: 'Designed', bodyHtml: TEMPLATE, designHtml: 'true' });
    expect(ok.status).toBe(200);
    const sent = getTestEmails().filter((m) => m.subject === 'Designed')[0]!;
    expect(sent.html).toContain('<table width="600" align="center" style="background-color: #ffffff">');
    expect(sent.html).toContain('<img src="https://cdn.example.com/logo.png" alt="Logo" width="120">');
    expect(sent.html).not.toContain('<script');
    expect(sent.html).not.toContain('<style');
    expect(sent.text).toContain('Big news');
    expect(sent.text).toContain('Read more (https://example.com/go)');
    expect(sent.text).toContain('Second column');
    expect(sent.replyTo).toBe('design-owner@example.test');

    // Without designHtml the same body still goes through the strict rich-text path (no tables).
    const plain = await send(owner, { to: 'a@example.test', subject: 'Plain', bodyHtml: TEMPLATE });
    expect(plain.status).toBe(200);
    const plainSent = getTestEmails().filter((m) => m.subject === 'Plain')[0]!;
    expect(plainSent.html).not.toContain('<table');
    expect(plainSent.html).not.toContain('<img');
  });

  it('exposes an admin-only sanitized preview', async () => {
    const owner = await signUpVerifiedAndGetCookie('design-prev-owner@example.test', { password: PASSWORD, name: 'Owner' });
    const editor = await signUpVerifiedAndGetCookie('design-prev-editor@example.test', { password: PASSWORD, name: 'Editor' });
    const call = (cookie: string) =>
      SELF.fetch(`${BASE}/api/v1/admin/email/sanitize-preview`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ html: '<table><tr><td onclick="x()">hi</td></tr></table><script>1</script>' }),
      });

    const ok = await call(owner);
    expect(ok.status).toBe(200);
    expect((await ok.json<{ html: string }>()).html).toBe('<table><tr><td>hi</td></tr></table>');
    expect((await call(editor)).status).toBe(403);
  });
});
