import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Backs the bounded, resumable public-cache purge queue (apps/api/src/lib/cache-purge.ts) —
// created because the Cache API is `caches.default.delete()` per key, and a full "purge
// everything" sweep or a large bulk import can need far more deletes than fit in one Worker
// invocation's subrequest budget (50 on Cloudflare's Free plan). `paths` is the complete,
// pre-computed list of cache-key pathnames this job needs to delete; `cursor` is how many of
// them have been processed so far, making a job resumable across invocations by construction —
// re-running the same batch (cursor unmoved) is always safe, since deleting an already-deleted
// or never-cached key is a harmless no-op (see public-cache.ts).
export const cachePurgeJobs = sqliteTable(
  'cache_purge_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paths: text('paths', { mode: 'json' }).notNull().$type<string[]>(),
    cursor: integer('cursor').notNull().default(0),
    status: text('status').notNull().$type<'pending' | 'completed'>().default('pending'),
    // Set when a batch throws partway through — never clears the job, just leaves it `pending`
    // so the next tick retries from the same cursor. Purely observability (Settings → Cache
    // could surface this later); nothing reads it to make a decision today.
    lastError: text('last_error'),
    lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
    // Millisecond precision (matching entries.createdAt) — the purge queue is processed
    // oldest-job-first, and two jobs created in the same request-heavy second (e.g. a manual
    // purge click landing in the same tick as a scheduled-publish enqueue) would otherwise tie.
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [index('cache_purge_jobs_status_created_at_idx').on(table.status, table.createdAt)],
);

export type CachePurgeJob = typeof cachePurgeJobs.$inferSelect;
export type NewCachePurgeJob = typeof cachePurgeJobs.$inferInsert;
