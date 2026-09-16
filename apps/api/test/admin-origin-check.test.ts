import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

// wrangler.test.toml's CORS_ORIGINS (see .dev.vars.example/wrangler.toml precedent) includes
// this exact origin — confirmed by the fact that every other cross-origin admin test in this
// suite already succeeds without ever setting an Origin header (requireTrustedOrigin passes a
// *missing* Origin through), so a real allow-listed one must also be discoverable; read from the
// live CORS middleware indirectly by asserting both the allowed and a clearly-foreign origin.
const ALLOWED_ORIGIN = 'http://localhost:5173';
const MALICIOUS_ORIGIN = 'https://attacker.example';

async function ownerCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

describe('admin CSRF/Origin protection (requireTrustedOrigin)', () => {
  it('allows a mutation with a configured, allow-listed Origin header', async () => {
    const cookie = await ownerCookie('origin-allowed@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ name: 'Allowed', slug: 'allowed-origin-ct' }),
    });
    expect(response.status).toBe(201);
  });

  it('allows a mutation with no Origin header at all (non-browser clients)', async () => {
    const cookie = await ownerCookie('origin-missing@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'NoOrigin', slug: 'no-origin-ct' }),
    });
    expect(response.status).toBe(201);
  });

  it('rejects a mutation whose Origin is not in the allow-list', async () => {
    const cookie = await ownerCookie('origin-malicious@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: MALICIOUS_ORIGIN },
      body: JSON.stringify({ name: 'Malicious', slug: 'malicious-origin-ct' }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Origin not allowed' });
  });

  it('never applies to GET/HEAD, even with a malicious Origin', async () => {
    const cookie = await ownerCookie('origin-get@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'GET',
      headers: { Cookie: cookie, Origin: MALICIOUS_ORIGIN },
    });
    expect(response.status).toBe(200);
  });

  it('never applies to public/non-admin routes, even with a malicious Origin', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health', {
      method: 'GET',
      headers: { Origin: MALICIOUS_ORIGIN },
    });
    expect(response.status).toBe(200);
  });

  it('does not block an unauthenticated admin request before requireSession runs (401, not 403)', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/admin/content-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: MALICIOUS_ORIGIN },
      body: JSON.stringify({ name: 'X', slug: 'x' }),
    });
    // requireSession runs before requireTrustedOrigin (index.ts mount order) — an
    // unauthenticated request 401s regardless of Origin, it never reaches the Origin check.
    expect(response.status).toBe(401);
  });
});
