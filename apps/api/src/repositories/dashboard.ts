import { contentTypes, count, desc, entries, eq, media, sum } from '@kenresoft/database';
import type { Database } from '@kenresoft/database';

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
