import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerWebsiteUser } from './helpers/auth';

// Regression: signing up with an already-registered email used to 500. better-auth answers that
// case with a synthetic user (no row) so the response can't enumerate accounts, and the
// auth.sign_up audit hook then tried to log an audit row against that non-existent user id and
// violated audit_log's foreign key. Matters more now that website users sign up through the same
// endpoint as staff: "already have an account" is a routine thing for a customer to do.
describe('duplicate sign-up (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('answers a sign-up for an already-registered email like a fresh one, and creates nothing', async () => {
    await registerWebsiteUser('dup@example.test');
    const auditedBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.sign_up'").first<{ n: number }>();

    const again = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.test', password: 'correct horse battery staple', name: 'Someone' }),
    });
    expect(again.status).toBe(200);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?').bind('dup@example.test').first<{ n: number }>();
    expect(count?.n).toBe(1);
    // The audit trail records no phantom sign-up for it.
    const audited = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.sign_up'").first<{ n: number }>();
    expect(audited?.n).toBe(auditedBefore?.n);
  });
});
