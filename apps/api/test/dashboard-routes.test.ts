import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { createContentType } from '../src/repositories/content-types';
import { createEntry } from '../src/repositories/entries';
import { createMedia } from '../src/repositories/media';

const db = createDb(env.DB);

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

describe('dashboard stats route (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('aggregates counts and recent activity across content types, entries, and media', async () => {
    const cookie = await authedCookie('dashboard-stats@pathvera.test');

    const blogPost = await createContentType(db, { name: 'Blog Post', slug: 'blog-post', description: null });
    const service = await createContentType(db, { name: 'Service', slug: 'service', description: null });

    await createEntry(db, blogPost.id, { slug: 'draft-one', status: 'draft', data: {} }, null);
    await createEntry(db, blogPost.id, { slug: 'draft-two', status: 'draft', data: {} }, null);
    await createEntry(db, service.id, { slug: 'published-one', status: 'published', data: {} }, null);

    await createMedia(db, {
      key: 'media/a.png',
      filename: 'a.png',
      contentType: 'image/png',
      size: 1000,
      width: 10,
      height: 10,
      altText: null,
    });
    await createMedia(db, {
      key: 'media/b.png',
      filename: 'b.png',
      contentType: 'image/png',
      size: 2500,
      width: 20,
      height: 20,
      altText: null,
    });

    const response = await SELF.fetch('https://example.com/api/v1/admin/dashboard', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);

    const stats = await response.json<{
      contentTypeCount: number;
      entryCounts: { draft: number; published: number };
      mediaCount: number;
      mediaStorageBytes: number;
      recentEntries: { slug: string; contentTypeName: string }[];
    }>();

    expect(stats.contentTypeCount).toBe(2);
    expect(stats.entryCounts).toEqual({ draft: 2, published: 1 });
    expect(stats.mediaCount).toBe(2);
    expect(stats.mediaStorageBytes).toBe(3500);
    expect(stats.recentEntries).toHaveLength(3);
    expect(stats.recentEntries[0]).toMatchObject({ slug: 'published-one', contentTypeName: 'Service' });
  });

  it('returns zeroed stats when nothing exists yet', async () => {
    const cookie = await authedCookie('dashboard-empty@pathvera.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/dashboard', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);

    const stats = await response.json<{
      contentTypeCount: number;
      entryCounts: { draft: number; published: number };
      mediaCount: number;
      mediaStorageBytes: number;
      recentEntries: unknown[];
    }>();

    expect(stats).toEqual({
      contentTypeCount: 0,
      entryCounts: { draft: 0, published: 0 },
      mediaCount: 0,
      mediaStorageBytes: 0,
      recentEntries: [],
    });
  });

  it('rejects the dashboard route without a session', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/admin/dashboard');
    expect(response.status).toBe(401);
  });
});
