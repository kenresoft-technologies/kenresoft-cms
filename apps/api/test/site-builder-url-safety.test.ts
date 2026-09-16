import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

const DANGEROUS_URLS = ['javascript:alert(1)', 'data:text/html,evil', 'vbscript:msgbox(1)', 'JaVaScRiPt:alert(1)'];
const SAFE_URLS = ['https://example.com', 'http://example.com/path', '/relative/path', 'mailto:me@example.com'];

// Server-side URL-safety validation (safeUrlSchema, packages/contracts/schemas/safe-url.ts) —
// applied at the contract boundary, not only in the Admin UI, so a direct API call bypasses
// nothing. Covers every field flagged in the audit: block ctaUrl/buttonUrl and Structured
// Settings' navigation/social/footer link URLs.
describe('Site Builder URL safety (server-side, contract boundary)', () => {
  it('rejects dangerous protocols on a Hero block\'s ctaUrl', async () => {
    const headers = await authedHeaders('url-safety-hero@example.test');
    for (const url of DANGEROUS_URLS) {
      const response = await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          route: `/hero-${DANGEROUS_URLS.indexOf(url)}`,
          title: 'Hero test',
          blocks: [{ id: 'hero-1', type: 'hero', config: { heading: 'Hi', ctaUrl: url } }],
        }),
      });
      expect(response.status, `expected ${url} to be rejected`).toBe(400);
    }
  });

  it('accepts safe protocols/relative paths on a Hero block\'s ctaUrl', async () => {
    const headers = await authedHeaders('url-safety-hero-ok@example.test');
    for (const [i, url] of SAFE_URLS.entries()) {
      const response = await SELF.fetch('https://example.com/api/v1/admin/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          route: `/hero-ok-${i}`,
          title: 'Hero test',
          blocks: [{ id: 'hero-1', type: 'hero', config: { heading: 'Hi', ctaUrl: url } }],
        }),
      });
      expect(response.status, `expected ${url} to be accepted`).toBe(201);
    }
  });

  it('rejects dangerous protocols on a CTA block\'s buttonUrl', async () => {
    const headers = await authedHeaders('url-safety-cta@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        route: '/cta-test',
        title: 'CTA test',
        blocks: [{ id: 'cta-1', type: 'cta', config: { buttonLabel: 'Go', buttonUrl: 'javascript:alert(1)' } }],
      }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a dangerous protocol on a Structured Settings social link', async () => {
    const headers = await authedHeaders('url-safety-social@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/social', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ links: [{ platform: 'github', label: 'GitHub', url: 'javascript:alert(1)' }] }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a dangerous protocol on a Structured Settings navigation item url', async () => {
    const headers = await authedHeaders('url-safety-nav@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/navigation', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [{ label: 'Evil', url: 'javascript:alert(1)', visible: true, order: 0, external: false, newTab: false }],
      }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts a relative navigation item url and rejects a protocol-relative one', async () => {
    const headers = await authedHeaders('url-safety-nav-ok@example.test');
    const ok = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/navigation', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [{ label: 'Home', url: '/', visible: true, order: 0, external: false, newTab: false }],
      }),
    });
    expect(ok.status).toBe(200);

    const protocolRelative = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/navigation', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [{ label: 'Ambiguous', url: '//attacker.example', visible: true, order: 0, external: false, newTab: false }],
      }),
    });
    expect(protocolRelative.status).toBe(400);
  });

  it('rejects a dangerous protocol on a Structured Settings footer link', async () => {
    const headers = await authedHeaders('url-safety-footer@example.test');
    const response = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/footer', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        description: null,
        copyrightText: null,
        links: [{ label: 'Evil', url: 'data:text/html,evil' }],
      }),
    });
    expect(response.status).toBe(400);
  });
});
