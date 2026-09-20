import { describe, expect, it } from 'vitest';

import { getClientIp } from '../src/lib/client-ip';

const h = (init: Record<string, string>) => new Headers(init);

describe('getClientIp', () => {
  it('uses CF-Connecting-IP by default and ignores proxy headers when no secret is configured', () => {
    const headers = h({ 'CF-Connecting-IP': '1.2.3.4', 'x-kenresoft-client-ip': '9.9.9.9', 'x-kenresoft-proxy-secret': 'anything' });
    expect(getClientIp(headers, {})).toBe('1.2.3.4');
  });

  it('trusts x-kenresoft-client-ip only when the shared secret matches', () => {
    const env = { TRUSTED_PROXY_SECRET: 's3cret' };
    expect(getClientIp(h({ 'CF-Connecting-IP': '10.0.0.1', 'x-kenresoft-proxy-secret': 's3cret', 'x-kenresoft-client-ip': '203.0.113.9' }), env)).toBe('203.0.113.9');
    expect(getClientIp(h({ 'CF-Connecting-IP': '10.0.0.1', 'x-kenresoft-proxy-secret': 'wrong', 'x-kenresoft-client-ip': '203.0.113.9' }), env)).toBe('10.0.0.1');
    expect(getClientIp(h({ 'CF-Connecting-IP': '10.0.0.1', 'x-kenresoft-client-ip': '203.0.113.9' }), env)).toBe('10.0.0.1');
  });

  it('falls back to local-dev with no headers at all', () => {
    expect(getClientIp(undefined, {})).toBe('local-dev');
    expect(getClientIp(h({}), { TRUSTED_PROXY_SECRET: 's' })).toBe('local-dev');
  });
});
