// Bounded, resumable processing for the public-cache purge queue (cache_purge_jobs) — see the
// schema comment (packages/database/schema/cache-purge-jobs.ts) for why this exists at all: a
// full "purge everything" sweep or a large bulk import can need far more Cache API deletes than
// fit in one Worker invocation's subrequest budget (50 on Cloudflare's Free plan, up to 10,000+
// on Paid — this deliberately never checks which, since a bounded queue is correct on either).
//
// Call sites never do their own Promise.all over an unbounded collection of cache keys anymore:
// they enumerate the keys once, enqueueCachePurgePaths() persists them, and this module drains
// the queue a fixed, small batch at a time — one call from the route that created the job (so a
// small catalog purges in a single click), and one more call every 5 minutes from the existing
// Cron Trigger (index.ts's `scheduled` handler) to keep draining anything left over.
import type { CachePurgeJob, Database } from '@kenresoft-cms/database';

import { publicCacheKey } from './public-cache';
import {
  createCachePurgeJob,
  getPendingCachePurgeJob,
  saveCachePurgeJobProgress,
} from '../repositories/cache-purge-jobs';

// Conservative on purpose: comfortably under the Free plan's 50-subrequest cap even alongside
// the couple of D1 reads/writes the same invocation also does. Bump this single constant (never
// scattered per-call-site limits) if a deployment is confirmed to be on a Paid plan and wants
// faster convergence — the architecture itself doesn't need to change either way.
export const CACHE_PURGE_BATCH_SIZE = 25;

export async function enqueueCachePurgePaths(db: Database, paths: string[]): Promise<CachePurgeJob> {
  return createCachePurgeJob(db, paths);
}

// Processes up to `batchSize` items starting at the job's current cursor. Safe to call
// repeatedly on the same job, including after a previous call threw partway through — items
// before the saved cursor are never revisited, and a Cache API delete on a key this exact job
// already deleted (or one that was never cached) is a harmless no-op, so even re-deleting the
// last item of a batch that failed to save its progress causes no harm.
export async function processCachePurgeJobBatch(
  db: Database,
  job: CachePurgeJob,
  batchSize: number = CACHE_PURGE_BATCH_SIZE,
): Promise<CachePurgeJob> {
  if (job.status === 'completed') return job;

  const cache = caches.default;
  const end = Math.min(job.cursor + batchSize, job.paths.length);
  let cursor = job.cursor;
  let lastError: string | null = null;

  try {
    for (; cursor < end; cursor++) {
      await cache.delete(publicCacheKey(job.paths[cursor]!));
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Cache purge job ${job.id} failed at item ${cursor} of ${job.paths.length}:`, error);
  }

  return saveCachePurgeJobProgress(db, job.id, {
    cursor,
    status: cursor >= job.paths.length ? 'completed' : 'pending',
    lastError,
    lastAttemptAt: new Date(),
  });
}

// The one entry point every call site uses to make progress on the queue — picks the oldest
// still-pending job (regardless of which route created it) and processes one bounded batch.
// A no-op when the queue is empty. Called once synchronously from the routes that enqueue new
// work (so a small purge completes in that same request) and once per tick from the scheduled
// handler, so a large one keeps draining in the background without anyone needing to re-click.
export async function processCachePurgeQueue(db: Database): Promise<void> {
  const job = await getPendingCachePurgeJob(db);
  if (!job) return;
  await processCachePurgeJobBatch(db, job);
}

// Used by the manual "Purge Cache" admin route: continues an already-pending job instead of
// enumerating and enqueueing a whole new full-sweep job on every click (which would just pile up
// redundant, mostly-overlapping jobs behind whatever's already draining) — a fresh sweep is only
// computed once nothing is left pending. `computePaths` is injected rather than imported
// directly so this module doesn't need to know how to enumerate entries/media itself.
export async function purgeAllPublicCache(
  db: Database,
  computePaths: () => Promise<string[]>,
): Promise<CachePurgeJob> {
  const existing = await getPendingCachePurgeJob(db);
  const job = existing ?? (await enqueueCachePurgePaths(db, await computePaths()));
  return processCachePurgeJobBatch(db, job);
}
