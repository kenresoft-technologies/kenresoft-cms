import { env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { enqueueCachePurgePaths, processCachePurgeJobBatch, processCachePurgeQueue, purgeAllPublicCache } from '../src/lib/cache-purge';
import { getCachePurgeJobById, getPendingCachePurgeJob } from '../src/repositories/cache-purge-jobs';

const db = createDb(env.DB);

describe('cache purge queue (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM cache_purge_jobs');
  });

  it('purges a small job in a single batch', async () => {
    const job = await enqueueCachePurgePaths(db, ['/api/v1/public/blog-post', '/api/v1/public/blog-post/a']);
    const result = await processCachePurgeJobBatch(db, job);
    expect(result.status).toBe('completed');
    expect(result.cursor).toBe(2);
  });

  it('a job with zero paths is created already completed', async () => {
    const job = await enqueueCachePurgePaths(db, []);
    expect(job.status).toBe('completed');
    expect(await getPendingCachePurgeJob(db)).toBeUndefined();
  });

  it('processes a job larger than one batch across multiple calls, never re-processing an earlier item', async () => {
    const paths = Array.from({ length: 7 }, (_, i) => `/api/v1/public/blog-post/item-${i}`);
    const job = await enqueueCachePurgePaths(db, paths);

    const afterFirst = await processCachePurgeJobBatch(db, job, 3);
    expect(afterFirst.status).toBe('pending');
    expect(afterFirst.cursor).toBe(3);

    const afterSecond = await processCachePurgeJobBatch(db, afterFirst, 3);
    expect(afterSecond.status).toBe('pending');
    expect(afterSecond.cursor).toBe(6);

    const afterThird = await processCachePurgeJobBatch(db, afterSecond, 3);
    expect(afterThird.status).toBe('completed');
    expect(afterThird.cursor).toBe(7);
  });

  it('processCachePurgeQueue drains the oldest pending job one batch at a time and is a no-op once empty', async () => {
    const job = await enqueueCachePurgePaths(db, ['/api/v1/public/a', '/api/v1/public/b', '/api/v1/public/c']);

    await processCachePurgeQueue(db); // drains one batch via the real default batch size (25) — finishes in one call
    const finished = await getCachePurgeJobById(db, job.id);
    expect(finished!.status).toBe('completed');

    // No pending job left — must not throw, must not create anything.
    await processCachePurgeQueue(db);
    expect(await getPendingCachePurgeJob(db)).toBeUndefined();
  });

  it('re-processing an already-completed job is a safe no-op (idempotent)', async () => {
    const job = await enqueueCachePurgePaths(db, ['/api/v1/public/a']);
    const completed = await processCachePurgeJobBatch(db, job);
    expect(completed.status).toBe('completed');

    const reprocessed = await processCachePurgeJobBatch(db, completed);
    expect(reprocessed).toEqual(completed);
  });

  it('purgeAllPublicCache continues an existing pending job instead of enumerating a redundant new one', async () => {
    const paths = Array.from({ length: 5 }, (_, i) => `/api/v1/public/blog-post/item-${i}`);
    const existingJob = await enqueueCachePurgePaths(db, paths);
    await processCachePurgeJobBatch(db, existingJob, 2); // still pending, cursor 2

    let computeCalls = 0;
    const result = await purgeAllPublicCache(db, async () => {
      computeCalls++;
      return ['/api/v1/public/should-not-be-used'];
    });

    expect(result.id).toBe(existingJob.id);
    expect(computeCalls).toBe(0);
  });

  it('purgeAllPublicCache computes a fresh sweep only when nothing is pending', async () => {
    let computeCalls = 0;
    const result = await purgeAllPublicCache(db, async () => {
      computeCalls++;
      return ['/api/v1/public/blog-post'];
    });

    expect(computeCalls).toBe(1);
    expect(result.status).toBe('completed');
  });
});
