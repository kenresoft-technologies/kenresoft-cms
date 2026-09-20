import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestEmails } from '../src/lib/email';
import { registerWebsiteUser, signUpVerifiedAndGetCookie } from './helpers/auth';

// Where a password-reset email may point (see unified-identity-recovery.test.ts for why the two
// files exist: RECOVERY_RATE_LIMITER's 3/60s bucket persists across a file's tests).
const RESET = 'https://example.com/api/v1/public/password-reset/request';

async function request(email: string, redirectUrl?: string) {
  return SELF.fetch(RESET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, ...(redirectUrl ? { redirectUrl } : {}) }),
  });
}

function lastResetText(email: string): string {
  return getTestEmails()
    .filter((m) => m.to === email && m.text.includes('token='))
    .at(-1)!.text;
}

describe('password-reset redirectUrl safety (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('only ever follows a redirectUrl whose origin is trusted, and never for CMS staff', async () => {
    await registerWebsiteUser('customer@example.test');
    await signUpVerifiedAndGetCookie('staff@example.test', { role: 'editor' });

    // An attacker-controlled origin is ignored: the customer gets the default (admin) link, not theirs.
    expect((await request('customer@example.test', 'https://attacker.example/steal')).status).toBe(200);
    const untrusted = lastResetText('customer@example.test');
    expect(untrusted).not.toContain('attacker.example');
    expect(untrusted).toContain('/reset-password?token=');

    // Even a trusted redirectUrl is never honored for a CMS staff account: staff always get the admin link.
    expect((await request('staff@example.test', 'http://localhost:5173/account/reset-password')).status).toBe(200);
    const staff = lastResetText('staff@example.test');
    expect(staff).not.toContain('/account/reset-password');
    expect(staff).toContain('/reset-password?token=');

    // Unknown email: the identical generic response, and nothing is sent.
    const before = getTestEmails().length;
    const unknown = await request('nobody@example.test', 'http://localhost:5173/account/reset-password');
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ message: 'If an account exists for that email, a password reset link has been sent.' });
    expect(getTestEmails().length).toBe(before);
  });
});
