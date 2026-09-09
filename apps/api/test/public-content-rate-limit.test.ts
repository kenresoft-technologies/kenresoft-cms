import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { vi } from 'vitest';

import { publicContentRateLimit } from '../src/middleware/public-content-rate-limit';
import type { Bindings } from '../src/lib/env';

function appWith(limitResult: { success: boolean }) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', publicContentRateLimit);
  app.all('*', (c) => c.json({ ok: true }));

  const limit = vi.fn().mockResolvedValue(limitResult);
  const env = { PUBLIC_CONTENT_RATE_LIMITER: { limit } } as unknown as Bindings;

  return { app, env, limit };
}

describe('publicContentRateLimit', () => {
  it('lets a GET through when the limiter allows it', async () => {
    const { app, env } = appWith({ success: true });
    const response = await app.request('/api/v1/public/blog-posts/hello-world', { method: 'GET' }, env);
    expect(response.status).toBe(200);
  });

  it('rejects a GET with 429 when the limiter denies it', async () => {
    const { app, env } = appWith({ success: false });
    const response = await app.request('/api/v1/public/blog-posts/hello-world', { method: 'GET' }, env);
    expect(response.status).toBe(429);
  });

  it('keys the limiter by CF-Connecting-IP', async () => {
    const { app, env, limit } = appWith({ success: true });
    await app.request('/api/v1/public/blog-posts', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }, env);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
  });
});
