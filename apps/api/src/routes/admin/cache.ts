import { createRoute } from '@hono/zod-openapi';
import { cachePurgeResultSchema } from '@kenresoft-cms/contracts';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { invalidatePublicEntryCache, invalidatePublicMediaCache } from '../../lib/public-cache';
import { listEntriesWithContentType } from '../../repositories/entries';
import { listMedia } from '../../repositories/media';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const cacheRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

// Admin-only, same tier as content-type/form creation. There's no way to enumerate what's
// actually sitting in Cloudflare's edge Cache API (no list operation exists for it), so this
// doesn't claim to — it re-derives every key the app could ever have written (one per
// published entry, one per media file, the same key-generation functions every write path
// already uses) and deletes each. A key that was never actually cached is just a no-op
// delete, not an error.
cacheRoute.openapi(
  createRoute({
    method: 'post',
    path: '/purge',
    tags: ['Cache'],
    summary: 'Purge the public API edge cache (admin only)',
    middleware: requireRole('admin'),
    responses: {
      200: {
        description: 'How many entry and media cache keys were purged.',
        content: { 'application/json': { schema: cachePurgeResultSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const [allEntries, allMedia] = await Promise.all([listEntriesWithContentType(db), listMedia(db)]);
    const publishedEntries = allEntries.filter((entry) => entry.status === 'published');

    await Promise.all([
      ...publishedEntries.map((entry) => invalidatePublicEntryCache(entry.contentTypeSlug, entry.slug)),
      ...allMedia.map((item) => invalidatePublicMediaCache(item.id)),
    ]);

    return c.json({ entriesPurged: publishedEntries.length, mediaPurged: allMedia.length }, 200);
  },
);
