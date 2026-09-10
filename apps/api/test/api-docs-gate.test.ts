import { createExecutionContext, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker from '../src/index';

describe('API_DOCS_ENABLED gate', () => {
  it('serves /api/v1/openapi.json and /api/v1/docs by default (var unset)', async () => {
    const ctx = createExecutionContext();
    const docsResponse = await worker.fetch(new Request('https://example.com/api/v1/openapi.json'), env, ctx);
    const scalarResponse = await worker.fetch(new Request('https://example.com/api/v1/docs'), env, ctx);

    expect(docsResponse.status).toBe(200);
    expect(scalarResponse.status).toBe(200);
  });

  it('404s both routes, indistinguishable from a nonexistent route, when set to "false"', async () => {
    const overriddenEnv = { ...env, API_DOCS_ENABLED: 'false' };
    const ctx = createExecutionContext();

    const docsResponse = await worker.fetch(new Request('https://example.com/api/v1/openapi.json'), overriddenEnv, ctx);
    const scalarResponse = await worker.fetch(new Request('https://example.com/api/v1/docs'), overriddenEnv, ctx);
    const realNotFound = await worker.fetch(new Request('https://example.com/api/v1/this-route-does-not-exist'), overriddenEnv, ctx);

    expect(docsResponse.status).toBe(404);
    expect(scalarResponse.status).toBe(404);
    expect(await docsResponse.text()).toBe(await realNotFound.text());
  });
});
