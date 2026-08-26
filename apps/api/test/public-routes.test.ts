import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { createContentType } from '../src/repositories/content-types';
import { createEntry } from '../src/repositories/entries';

const db = createDb(env.DB);

describe('public content routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM content_types');
  });

  it('404s for a content type that does not exist', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/public/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('404s for an entry that does not exist', async () => {
    await createContentType(db, { name: 'Blog Post', slug: 'blog-post', description: null });

    const response = await SELF.fetch(
      'https://example.com/api/v1/public/blog-post/does-not-exist',
    );
    expect(response.status).toBe(404);
  });

  it('serves a published entry by content-type slug and entry slug', async () => {
    const contentType = await createContentType(db, {
      name: 'Blog Post',
      slug: 'blog-post',
      description: null,
    });
    await createEntry(
      db,
      contentType.id,
      { slug: 'hello-world', status: 'published', data: { title: 'Hello World' } },
      null,
    );

    const response = await SELF.fetch('https://example.com/api/v1/public/blog-post/hello-world');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      slug: 'hello-world',
      status: 'published',
      data: { title: 'Hello World' },
    });
  });

  it('404s a draft entry by slug, exactly like a slug that does not exist', async () => {
    const contentType = await createContentType(db, {
      name: 'Blog Post',
      slug: 'blog-post',
      description: null,
    });
    await createEntry(
      db,
      contentType.id,
      { slug: 'still-drafting', status: 'draft', data: { title: 'Not ready' } },
      null,
    );

    const response = await SELF.fetch(
      'https://example.com/api/v1/public/blog-post/still-drafting',
    );
    expect(response.status).toBe(404);
  });

  it('lists only published entries for a content type, never drafts', async () => {
    const contentType = await createContentType(db, {
      name: 'Blog Post',
      slug: 'blog-post',
      description: null,
    });
    await createEntry(
      db,
      contentType.id,
      { slug: 'published-post', status: 'published', data: { title: 'Published' } },
      null,
    );
    await createEntry(
      db,
      contentType.id,
      { slug: 'draft-post', status: 'draft', data: { title: 'Draft' } },
      null,
    );

    const response = await SELF.fetch('https://example.com/api/v1/public/blog-post');
    expect(response.status).toBe(200);
    const body = await response.json<{ slug: string }[]>();
    expect(body).toHaveLength(1);
    expect(body[0]!.slug).toBe('published-post');
  });

  it('requires no session — public routes are not gated by requireSession', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/public/blog-post');
    // 404 (content type doesn't exist in this test's fresh DB), not 401 — proves no auth gate.
    expect(response.status).toBe(404);
  });
});
