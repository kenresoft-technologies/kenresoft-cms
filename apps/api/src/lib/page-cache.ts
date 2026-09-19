import type { Database } from '@kenresoft-cms/database';

import { listPages } from '../repositories/pages';
import { enqueueCachePurgePaths, processCachePurgeJobBatch } from './cache-purge';

// Purges every public page's edge-cache entry plus the list cache, through the existing
// cache_purge_jobs queue. Used when something that affects what *any* page renders changes — a
// reusable block edit, or the Raw HTML feature flag being switched (its kill switch must take
// effect on already-cached pages immediately, not after the cache TTL).
export async function invalidateAllPageCaches(db: Database): Promise<void> {
  const allPages = await listPages(db);
  const paths = new Set<string>(['/api/v1/public/pages']);
  for (const page of allPages) {
    paths.add(`/api/v1/public/pages/by-route?route=${encodeURIComponent(page.route)}`);
  }
  const job = await enqueueCachePurgePaths(db, Array.from(paths));
  // Awaited directly (not itself handed to ctx.waitUntil) — callers already run this inside their
  // own ctx.waitUntil(...), and a nested waitUntil isn't guaranteed to drain before the outer one
  // settles.
  await processCachePurgeJobBatch(db, job);
}
