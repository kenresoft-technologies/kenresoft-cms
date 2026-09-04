import { contentTypes, count, desc, entries, eq, media, sum } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

export interface DashboardStats {
  contentTypeCount: number;
  entryCounts: { draft: number; published: number };
  mediaCount: number;
  mediaStorageBytes: number;
  recentEntries: {
    id: string;
    slug: string;
    status: string;
    contentTypeId: string;
    contentTypeName: string;
    updatedAt: Date;
  }[];
}

// No real D1 database-size figure is computed here — confirmed empirically (not assumed)
// against a real local D1 instance that D1 rejects both `PRAGMA page_count;` and
// `SELECT * FROM pragma_page_count();` with "not authorized: SQLITE_AUTH", even though the
// sibling `PRAGMA page_size;` is allowed. Without a real page count there's no honest way to
// derive total bytes, so the admin's Storage Usage card shows real content-type/entry counts
// for the database instead of a fabricated size — don't re-attempt this pragma.
export async function getDashboardStats(db: Database): Promise<DashboardStats> {
  const [contentTypeCountRow] = await db.select({ value: count() }).from(contentTypes);
  const entryStatusRows = await db
    .select({ status: entries.status, value: count() })
    .from(entries)
    .groupBy(entries.status);
  const [mediaAggRow] = await db.select({ value: count(), totalSize: sum(media.size) }).from(media);

  const recentEntries = await db
    .select({
      id: entries.id,
      slug: entries.slug,
      status: entries.status,
      contentTypeId: entries.contentTypeId,
      contentTypeName: contentTypes.name,
      updatedAt: entries.updatedAt,
    })
    .from(entries)
    .innerJoin(contentTypes, eq(entries.contentTypeId, contentTypes.id))
    .orderBy(desc(entries.updatedAt))
    .limit(5);

  const entryCounts = { draft: 0, published: 0 };
  for (const row of entryStatusRows) {
    if (row.status === 'draft') entryCounts.draft = row.value;
    else if (row.status === 'published') entryCounts.published = row.value;
  }

  return {
    contentTypeCount: contentTypeCountRow?.value ?? 0,
    entryCounts,
    mediaCount: mediaAggRow?.value ?? 0,
    mediaStorageBytes: Number(mediaAggRow?.totalSize ?? 0),
    recentEntries,
  };
}
