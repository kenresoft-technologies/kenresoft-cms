import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /api/v1/health', () => {
  it('round-trips D1 and returns ok', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', version: 'v1' });
  });

  it('applies the required security headers', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health');

    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('rejects CORS preflight from an origin not on the allow-list', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health', {
      headers: { Origin: 'https://evil.example.com' },
    });

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('serves a valid OpenAPI document describing this route', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/openapi.json');

    expect(response.status).toBe(200);
    const doc = await response.json<{ paths: Record<string, unknown> }>();
    expect(doc.paths).toHaveProperty('/api/v1/health');
  });
});
