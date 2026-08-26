import { and, contentTypes, entries, eq } from '@kenresoft/database';
import type { Database, Entry, NewEntry } from '@kenresoft/database';

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

export function getEntryById(db: Database, id: string): Promise<Entry | undefined> {
  return db.query.entries.findFirst({ where: eq(entries.id, id) });
}

export async function updateEntry(
  db: Database,
  id: string,
  input: {
    slug?: NewEntry['slug'] | undefined;
    status?: NewEntry['status'] | undefined;
    data?: NewEntry['data'] | undefined;
  },
): Promise<Entry | undefined> {
  const [entry] = await db
    .update(entries)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(entries.id, id))
    .returning();
  return entry;
}

export async function deleteEntry(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(entries).where(eq(entries.id, id)).returning({ id: entries.id });
  return Boolean(deleted);
}
