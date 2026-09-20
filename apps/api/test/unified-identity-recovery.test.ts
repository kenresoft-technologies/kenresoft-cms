import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAuth } from '../src/lib/auth';
import { getTestEmails } from '../src/lib/email';
import type { Bindings } from '../src/lib/env';
import { registerWebsiteUser } from './helpers/auth';

// A Commerce customer's password reset is Core's (the same hashed-at-rest, single-use,
// enumeration-safe flow CMS staff use), pointed at the customer's own site via `redirectUrl`.
// RECOVERY_RATE_LIMITER (3/60s) persists across every it() in a file, so this file makes exactly
// three recovery-route calls; the redirect-safety cases live in unified-identity-recovery-redirects.
const RESET = 'https://example.com/api/v1/public/password-reset';
const CUSTOMER = 'https://example.com/api/plugins/commerce/public/v1/customer';
const SITE_RESET = 'http://localhost:5173/account/reset-password';

function resetTokenFor(email: string): string {
  const message = getTestEmails()
    .filter((m) => m.to === email && m.text.includes('token='))
    .at(-1);
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no reset email captured for ${email}`);
  return match[1]!;
}

describe('customer password reset uses the core recovery flow (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('emails a link to the customer’s own site, resets once, revokes every session, and the new password works', async () => {
    const { cookie } = await registerWebsiteUser('reset-me@example.test');
    expect((await SELF.fetch(CUSTOMER, { headers: { Cookie: cookie } })).status).toBe(200);

    const request = await SELF.fetch(`${RESET}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-me@example.test', redirectUrl: SITE_RESET }),
    });
    expect(request.status).toBe(200);

    const email = getTestEmails().filter((m) => m.to === 'reset-me@example.test').at(-1)!;
    expect(email.text).toContain(`${SITE_RESET}?token=`);
    expect(email.text).not.toContain('/reset-password?token=http'); // not the admin app's page

    const token = resetTokenFor('reset-me@example.test');
    const confirm = await SELF.fetch(`${RESET}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'a brand new password' }),
    });
    expect(confirm.status).toBe(200);

    // Every existing customer session is gone...
    expect((await SELF.fetch(CUSTOMER, { headers: { Cookie: cookie } })).status).toBe(401);

    // ...the new password signs in through core...
    const auth = createAuth(env as unknown as Bindings);
    const signIn = await auth.api.signInEmail({
      body: { email: 'reset-me@example.test', password: 'a brand new password' },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);

    // ...and the token is single-use.
    const reuse = await SELF.fetch(`${RESET}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'another password entirely' }),
    });
    expect(reuse.status).toBe(400);
  });
});
