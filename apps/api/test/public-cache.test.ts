import {
  SELF,
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { createDb } from '@kenresoft/database';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../src/index';
import { createContentType } from '../src/repositories/content-types';
import { createEntry, updateEntry } from '../src/repositories/entries';

const db = createDb(env.DB);

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

describe('public content API caching (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('serves a cached response on a repeat GET, even after the underlying row changes', async () => {
    const contentType = await createContentType(db, {
      name: 'Blog Post',
      slug: 'blog-post',
      description: null,
    });
    const entry = await createEntry(
      db,
      contentType.id,
      { slug: 'hello-world', status: 'published', data: { title: 'Original' } },
      null,
    );

    const first = await SELF.fetch('https://example.com/api/v1/public/blog-post/hello-world');
    expect(await first.json()).toMatchObject({ data: { title: 'Original' } });

    // Bypasses the admin route entirely, so no cache invalidation runs — proves the second
    // fetch below is served from cache, not recomputed from D1.
    await updateEntry(db, entry.id, { data: { title: 'Changed behind the cache' } }, null);

    const second = await SELF.fetch('https://example.com/api/v1/public/blog-post/hello-world');
    expect(await second.json()).toMatchObject({ data: { title: 'Original' } });
  });

  it('invalidates the cache when an admin edit goes through the API', async () => {
    const cookie = await authedCookie('cache-invalidate@pathvera.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();
    const entry = await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'hello-world', status: 'published', data: { title: 'Original' } }),
      })
    ).json<{ id: string }>();

    const first = await SELF.fetch('https://example.com/api/v1/public/blog-post/hello-world');
    expect(await first.json()).toMatchObject({ data: { title: 'Original' } });

    await SELF.fetch(`https://example.com/api/v1/admin/entries/${entry.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ data: { title: 'Edited via admin API' } }),
    });

    const second = await SELF.fetch('https://example.com/api/v1/public/blog-post/hello-world');
    expect(await second.json()).toMatchObject({ data: { title: 'Edited via admin API' } });
  });

  it('invalidates the list cache once the scheduled sweep auto-publishes a due draft', async () => {
    const contentType = await createContentType(db, {
      name: 'Blog Post',
      slug: 'blog-post',
      description: null,
    });
    await createEntry(
      db,
      contentType.id,
      { slug: 'due-soon', status: 'draft', data: { title: 'Queued' }, publishAt: new Date(Date.now() - 60_000) },
      null,
    );

    const before = await SELF.fetch('https://example.com/api/v1/public/blog-post');
    expect(await before.json()).toEqual([]);

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    const after = await SELF.fetch('https://example.com/api/v1/public/blog-post');
    const afterBody = await after.json<{ slug: string }[]>();
    expect(afterBody).toHaveLength(1);
    expect(afterBody[0]!.slug).toBe('due-soon');
  });
});
