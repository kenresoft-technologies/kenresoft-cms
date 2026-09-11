import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

const SETTINGS_BASE = 'https://example.com/api/plugins/commerce/v1/settings';

async function signUp(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

// Real end-to-end wiring against real D1 — apps/api/test/paystack-provider.test.ts already
// covers getStatus()'s configured/environment logic exhaustively against a fake env, so this file
// only needs to prove the route is reachable, requires a real session, and — the actual point of
// this feature's security constraint — that the response never carries anything beyond
// provider/configured/environment. apps/api/vitest.config.ts sets a fake, never-used
// `sk_test_only_...` PAYSTACK_SECRET_KEY for this test runtime specifically so this route (and
// every other payments route) can be exercised as "configured" without a real credential.
describe('commerce plugin: GET /settings/payment-status (real D1)', () => {
  it('requires a real session, same as every other admin plugin route', async () => {
    const res = await SELF.fetch(`${SETTINGS_BASE}/payment-status`);
    expect(res.status).toBe(401);
  });

  it('reports the test environment and never exposes anything beyond provider/configured/environment', async () => {
    const cookie = await signUp('commerce-payment-status@example.test');
    const res = await SELF.fetch(`${SETTINGS_BASE}/payment-status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body).toEqual({ provider: 'Paystack', configured: true, environment: 'test' });
    expect(Object.keys(body).sort()).toEqual(['configured', 'environment', 'provider']);
  });
});
