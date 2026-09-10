import { asc, cachePurgeJobs, eq } from '@kenresoft-cms/database';
import type { CachePurgeJob, Database } from '@kenresoft-cms/database';

// An empty path list is already done on arrival (e.g. the manual purge button clicked against
// a catalog with nothing published yet) — inserted as `completed` rather than a pending job
// with nothing to process, so it never gets picked up by getPendingCachePurgeJob().
export async function createCachePurgeJob(db: Database, paths: string[]): Promise<CachePurgeJob> {
  const [row] = await db
    .insert(cachePurgeJobs)
    .values({ paths, cursor: 0, status: paths.length === 0 ? 'completed' : 'pending' })
    .returning();
  return row!;
}

// Oldest pending job first (FIFO) — a job created by a manual "Purge Cache" click, a bulk
// import, or the scheduled-publish sweep are all the same kind of row and share one queue, so
// whichever has been waiting longest gets the next batch regardless of where it came from.
export function getPendingCachePurgeJob(db: Database): Promise<CachePurgeJob | undefined> {
  return db.query.cachePurgeJobs.findFirst({
    where: eq(cachePurgeJobs.status, 'pending'),
    orderBy: asc(cachePurgeJobs.createdAt),
  });
}

export function getCachePurgeJobById(db: Database, id: string): Promise<CachePurgeJob | undefined> {
  return db.query.cachePurgeJobs.findFirst({ where: eq(cachePurgeJobs.id, id) });
}

export async function saveCachePurgeJobProgress(
  db: Database,
  id: string,
  input: { cursor: number; status: 'pending' | 'completed'; lastError: string | null; lastAttemptAt: Date },
): Promise<CachePurgeJob> {
  const [row] = await db
    .update(cachePurgeJobs)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(cachePurgeJobs.id, id))
    .returning();
  return row!;
}
