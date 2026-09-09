import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { recoveryRateLimit } from '../src/middleware/recovery-rate-limit';
import type { Bindings } from '../src/lib/env';

function appWith(limitResult: { success: boolean }) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', recoveryRateLimit);
  app.all('*', (c) => c.json({ ok: true }));

  const limit = vi.fn().mockResolvedValue(limitResult);
  const env = { RECOVERY_RATE_LIMITER: { limit } } as unknown as Bindings;

  return { app, env, limit };
}

describe('recoveryRateLimit', () => {
  it('lets a request through when the limiter allows it', async () => {
    const { app, env } = appWith({ success: true });
    const response = await app.request('/api/v1/public/password-reset/request', { method: 'POST' }, env);
    expect(response.status).toBe(200);
  });

  it('rejects a request with 429 when the limiter denies it', async () => {
    const { app, env } = appWith({ success: false });
    const response = await app.request('/api/v1/public/password-reset/request', { method: 'POST' }, env);
    expect(response.status).toBe(429);
  });
});
