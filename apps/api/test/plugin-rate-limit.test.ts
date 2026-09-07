import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createPluginRateLimitMiddleware } from '../src/plugins/plugin-rate-limit';
import type { Bindings } from '../src/lib/env';

// Mirrors auth-rate-limit.test.ts's own pattern exactly: a mocked `.limit()` rather than driving
// the real Cloudflare Rate Limiting binding through many real requests — the real binding's
// actual accumulation behavior is proven correct once, for real, in the commerce-customer-auth
// integration tests' own comment (a throwaway debug run showed exactly 10 successes then 429s
// from the 11th call); this file is purely about createPluginRateLimitMiddleware's own logic
// (dynamic binding-name lookup, fail-open-with-warning on a missing binding), not the binding.
function appWith(bindingName: string, env: Record<string, unknown>) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', createPluginRateLimitMiddleware(bindingName));
  app.all('*', (c) => c.json({ ok: true }));
  return { app, env: env as unknown as Bindings };
}

describe('createPluginRateLimitMiddleware', () => {
  it('lets a request through when the named binding allows it', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const { app, env } = appWith('SOME_LIMITER', { SOME_LIMITER: { limit } });
    const response = await app.request('/anything', {}, env);
    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: 'local-dev' });
  });

  it('rejects with 429 when the named binding denies it', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const { app, env } = appWith('SOME_LIMITER', { SOME_LIMITER: { limit } });
    const response = await app.request('/anything', {}, env);
    expect(response.status).toBe(429);
  });

  it('uses CF-Connecting-IP as the rate-limit key when present', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const { app, env } = appWith('SOME_LIMITER', { SOME_LIMITER: { limit } });
    await app.request('/anything', { headers: { 'CF-Connecting-IP': '203.0.113.5' } }, env);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.5' });
  });

  it('fails open (allows the request) with a warning when the named binding is not configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, env } = appWith('MISSING_BINDING', {});
    const response = await app.request('/anything', {}, env);
    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
