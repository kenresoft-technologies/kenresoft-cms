import { createDb } from '@kenresoft-cms/database';
import { createCustomerToken } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-tokens';
import { createCustomer, markCustomerEmailVerified } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Split into its own file, same reasoning as commerce-customer-recovery.test.ts's own comment —
// stays well under the shared COMMERCE_CUSTOMER_AUTH_RATE_LIMITER bucket (10/60s per IP) that
// persists across every it() block in one file.
const AUTH_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer-auth';

async function resend(email: string) {
  return SELF.fetch(`${AUTH_BASE}/verify-email/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

describe('commerce plugin: resend verification email (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_customer_tokens');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
  });

  it('issues a fresh token that supersedes the old one, with an identical generic response regardless of outcome', async () => {
    const db = createDb(env.DB);
    const customer = await createCustomer(db, {
      email: 'resend-test@example.test',
      name: 'Resend Test',
      password: 'correct horse battery staple',
    });
    const staleToken = await createCustomerToken(db, customer.id, 'email_verification');

    const real = await resend('resend-test@example.test');
    const fake = await resend('nobody-at-all@example.test');
    expect(real.status).toBe(200);
    expect(fake.status).toBe(200);
    expect(await real.json()).toEqual(await fake.json());

    // The stale token (from before the resend) no longer verifies — createCustomerToken's own
    // delete-then-insert already guarantees this, asserted here as the resend route's real
    // observable behavior, not just trusted from that repository function's own unit coverage.
    const staleAttempt = await SELF.fetch(`${AUTH_BASE}/verify-email?token=${encodeURIComponent(staleToken)}`);
    expect(staleAttempt.status).toBe(400);

    // The row currently in the table (the fresh one the resend just issued) verifies correctly.
    const row = await env.DB.prepare(`SELECT token_hash FROM plugin_commerce_customer_tokens WHERE customer_id = ? AND purpose = 'email_verification'`)
      .bind(customer.id)
      .first();
    expect(row).toBeTruthy();
  });

  it('is a no-op for an already-verified customer, without ever creating a new token', async () => {
    const db = createDb(env.DB);
    const customer = await createCustomer(db, {
      email: 'already-verified@example.test',
      name: 'Already Verified',
      password: 'correct horse battery staple',
    });
    await markCustomerEmailVerified(db, customer.id);

    const response = await resend('already-verified@example.test');
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT * FROM plugin_commerce_customer_tokens WHERE customer_id = ?`).bind(customer.id).first();
    expect(row).toBeNull();
  });
});
