import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signUpTurnstile, verifyTurnstileToken } from '../src/middleware/turnstile';
import type { Bindings } from '../src/lib/env';

// The middleware in isolation on a tiny app (mirrors plugin-rate-limit.test.ts): SELF.fetch would
// exercise every other test's sign-up helpers too, none of which carry a Turnstile token.
function app() {
  const a = new Hono<{ Bindings: Bindings }>();
  a.use('*', signUpTurnstile);
  a.post('/api/v1/auth/sign-up/email', (c) => c.json({ ok: true }));
  a.post('/api/v1/auth/sign-in/email', (c) => c.json({ ok: true }));
  a.get('/api/v1/auth/get-session', (c) => c.json({ ok: true }));
  return a;
}
const call = (a: ReturnType<typeof app>, path: string, env: Partial<Bindings>, init: RequestInit = { method: 'POST' }) =>
  a.request(`https://example.com${path}`, init, env as Bindings);

function mockSiteverify(result: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(result), { status }));
}

describe('sign-up Turnstile check', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does nothing when TURNSTILE_SECRET_KEY is not set (existing deployments unchanged)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await call(app(), '/api/v1/auth/sign-up/email', {});
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('only guards sign-up: other auth routes and methods pass through untouched', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const env = { TURNSTILE_SECRET_KEY: 's' };
    expect((await call(app(), '/api/v1/auth/sign-in/email', env)).status).toBe(200);
    expect((await call(app(), '/api/v1/auth/get-session', env, { method: 'GET' })).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a sign-up with no token (400 TURNSTILE_REQUIRED) without calling Cloudflare', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await call(app(), '/api/v1/auth/sign-up/email', { TURNSTILE_SECRET_KEY: 's' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('TURNSTILE_REQUIRED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an oversized token without calling Cloudflare', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await call(app(), '/api/v1/auth/sign-up/email', { TURNSTILE_SECRET_KEY: 's' }, { method: 'POST', headers: { 'x-turnstile-token': 'x'.repeat(3000) } });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('lets a sign-up through when Cloudflare says the token is valid, sending secret, token and client IP', async () => {
    const spy = mockSiteverify({ success: true });
    const res = await call(app(), '/api/v1/auth/sign-up/email', { TURNSTILE_SECRET_KEY: 'sekret' }, { method: 'POST', headers: { 'x-turnstile-token': 'tok', 'CF-Connecting-IP': '203.0.113.7' } });
    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const sent = (init as RequestInit).body as URLSearchParams;
    expect(sent.get('secret')).toBe('sekret');
    expect(sent.get('response')).toBe('tok');
    expect(sent.get('remoteip')).toBe('203.0.113.7');
  });

  it('403 TURNSTILE_FAILED for a token Cloudflare rejects', async () => {
    mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const res = await call(app(), '/api/v1/auth/sign-up/email', { TURNSTILE_SECRET_KEY: 's' }, { method: 'POST', headers: { 'x-turnstile-token': 'bad' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('TURNSTILE_FAILED');
  });

  it('fails closed with 503 when Cloudflare cannot be reached (never lets the sign-up through)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const res = await call(app(), '/api/v1/auth/sign-up/email', { TURNSTILE_SECRET_KEY: 's' }, { method: 'POST', headers: { 'x-turnstile-token': 'tok' } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('TURNSTILE_UNAVAILABLE');
    mockSiteverify({}, 500);
    expect(await verifyTurnstileToken('s', 't')).toBe('unavailable');
  });
});
