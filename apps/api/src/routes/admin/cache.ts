import { createRoute } from '@hono/zod-openapi';
import { cachePurgeJobStatusSchema } from '@kenresoft-cms/contracts';
import type { CachePurgeJob, Database } from '@kenresoft-cms/database';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { purgeAllPublicCache } from '../../lib/cache-purge';
import { listEntriesWithContentType } from '../../repositories/entries';
import { listMedia } from '../../repositories/media';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const cacheRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

function toCachePurgeJobStatus(job: CachePurgeJob) {
  return {
    id: job.id,
    totalItems: job.paths.length,
    processedItems: job.cursor,
    done: job.status === 'completed',
  };
}

// There's no way to enumerate what's actually sitting in Cloudflare's edge Cache API (no list
// operation exists for it), so this doesn't claim to — it re-derives every key the app could
// ever have written (one list key per content type with a published entry, one detail key per
// published entry, one per media file) the same way every write path already does, and queues
// each for deletion. A key that was never actually cached is just a no-op delete, not an error.
async function computeFullSweepPurgePaths(db: Database): Promise<string[]> {
  const [allEntries, allMedia] = await Promise.all([listEntriesWithContentType(db), listMedia(db)]);
  const paths = new Set<string>();
  for (const entry of allEntries) {
    if (entry.status !== 'published') continue;
    paths.add(`/api/v1/public/${entry.contentTypeSlug}`);
    paths.add(`/api/v1/public/${entry.contentTypeSlug}/${entry.slug}`);
  }
  for (const item of allMedia) {
    paths.add(`/api/v1/public/media/${item.id}/file`);
  }
  return Array.from(paths);
}

// Admin-only, same tier as content-type/form creation. Processes one bounded batch of the
// public-cache purge queue per call (see lib/cache-purge.ts) rather than deleting every key in
// one giant parallel sweep — a catalog large enough to need more than one batch keeps draining
// on the existing 5-minute Cron Trigger, and clicking the button again (or polling this same
// route) just continues the same job instead of starting a redundant new one.
cacheRoute.openapi(
  createRoute({
    method: 'post',
    path: '/purge',
    tags: ['Cache'],
    summary: 'Purge the public API edge cache (admin only)',
    middleware: requireRole('admin'),
    responses: {
      200: {
        description: 'The purge job’s progress — poll again (or click the button again) while `done` is false.',
        content: { 'application/json': { schema: cachePurgeJobStatusSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const job = await purgeAllPublicCache(db, () => computeFullSweepPurgePaths(db));
    return c.json(toCachePurgeJobStatus(job), 200);
  },
);
