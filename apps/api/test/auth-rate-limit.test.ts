import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { authRateLimit } from '../src/middleware/auth-rate-limit';
import type { Bindings } from '../src/lib/env';

function appWith(limitResult: { success: boolean }) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', authRateLimit);
  app.all('*', (c) => c.json({ ok: true }));

  const limit = vi.fn().mockResolvedValue(limitResult);
  const env = { AUTH_RATE_LIMITER: { limit } } as unknown as Bindings;

  return { app, env, limit };
}

describe('authRateLimit', () => {
  it('lets a POST through when the limiter allows it', async () => {
    const { app, env } = appWith({ success: true });
    const response = await app.request('/api/v1/auth/sign-in/email', { method: 'POST' }, env);
    expect(response.status).toBe(200);
  });

  it('rejects a POST with 429 when the limiter denies it', async () => {
    const { app, env } = appWith({ success: false });
    const response = await app.request('/api/v1/auth/sign-in/email', { method: 'POST' }, env);
    expect(response.status).toBe(429);
  });

  it('never consults the limiter for a GET (e.g. get-session)', async () => {
    const { app, env, limit } = appWith({ success: false });
    const response = await app.request('/api/v1/auth/get-session', { method: 'GET' }, env);
    expect(response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });

  // The middleware is method-based, not an explicit path allow-list — this confirms that
  // extends automatically to email-verification's own routes without needing route-specific
  // wiring: POST /send-verification-email (manual resend, and the same request sendOnSignIn's
  // auto-resend rides on) is rate limited, while GET /verify-email (consuming a token — no
  // credential-guessing surface) is exempt like every other GET.
  it('rate limits POST /send-verification-email like any other POST', async () => {
    const { app, env } = appWith({ success: false });
    const response = await app.request('/api/v1/auth/send-verification-email', { method: 'POST' }, env);
    expect(response.status).toBe(429);
  });

  it('never consults the limiter for GET /verify-email', async () => {
    const { app, env, limit } = appWith({ success: false });
    const response = await app.request('/api/v1/auth/verify-email?token=x', { method: 'GET' }, env);
    expect(response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });
});
