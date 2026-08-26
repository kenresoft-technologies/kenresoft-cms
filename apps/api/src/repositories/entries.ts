import { and, eq } from 'drizzle-orm';
import { contentTypes, entries } from '@kenresoft/database';
import type { Database, Entry, EntryStatus, NewEntry } from '@kenresoft/database';

export async function createEntry(
  db: Database,
  contentTypeId: string,
  input: Pick<NewEntry, 'slug' | 'status' | 'data'>,
): Promise<Entry> {
  const contentType = await db.query.contentTypes.findFirst({
    where: eq(contentTypes.id, contentTypeId),
  });
  if (!contentType) {
    throw new Error(`Content type ${contentTypeId} not found`);
  }

  const [entry] = await db
    .insert(entries)
    .values({ ...input, contentTypeId, projectId: contentType.projectId })
    .returning();
  return entry!;
}

export function listEntriesForContentType(
  db: Database,
  contentTypeId: string,
): Promise<Entry[]> {
  return db.query.entries.findMany({ where: eq(entries.contentTypeId, contentTypeId) });
}

export function getEntryBySlug(
  db: Database,
  contentTypeId: string,
  slug: string,
): Promise<Entry | undefined> {
  return db.query.entries.findFirst({
    where: and(eq(entries.contentTypeId, contentTypeId), eq(entries.slug, slug)),
  });
}

export async function setEntryStatus(
  db: Database,
  id: string,
  status: EntryStatus,
): Promise<Entry> {
  const [entry] = await db
    .update(entries)
    .set({ status, updatedAt: new Date() })
    .where(eq(entries.id, id))
    .returning();
  if (!entry) {
    throw new Error(`Entry ${id} not found`);
  }
  return entry;
}
