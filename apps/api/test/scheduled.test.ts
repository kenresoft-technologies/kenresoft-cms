import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../src/index';
import { createContentType } from '../src/repositories/content-types';
import { createEntry, getEntryById, listEntryRevisions } from '../src/repositories/entries';

const db = createDb(env.DB);

async function seedEntry(status: 'draft' | 'published', publishAt: Date | null) {
  const contentType = await createContentType(db, {
    name: 'Blog Post',
    slug: 'blog-post',
    description: null,
  });
  return createEntry(db, contentType.id, { slug: 'hello-world', status, data: {}, publishAt }, null);
}

async function runScheduled() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);
}

describe('scheduled publishing (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
  });

  it('publishes a draft entry whose publishAt has elapsed, and records the transition as a revision', async () => {
    const entry = await seedEntry('draft', new Date(Date.now() - 60_000));

    await runScheduled();

    const updated = await getEntryById(db, entry.id);
    expect(updated?.status).toBe('published');

    const revisions = await listEntryRevisions(db, entry.id);
    expect(revisions[0]).toMatchObject({ status: 'draft', createdBy: null });
  });

  it('leaves a draft with a future publishAt untouched', async () => {
    const entry = await seedEntry('draft', new Date(Date.now() + 60 * 60_000));

    await runScheduled();

    expect((await getEntryById(db, entry.id))?.status).toBe('draft');
  });

  it('leaves a draft with no publishAt untouched', async () => {
    const entry = await seedEntry('draft', null);

    await runScheduled();

    expect((await getEntryById(db, entry.id))?.status).toBe('draft');
  });

  it('does not touch entries that are already published', async () => {
    const entry = await seedEntry('published', new Date(Date.now() - 60_000));
    const before = await getEntryById(db, entry.id);

    await runScheduled();

    const after = await getEntryById(db, entry.id);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });
});
