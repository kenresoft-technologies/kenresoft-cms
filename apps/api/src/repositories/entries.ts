import { and, contentTypes, desc, entries, entryRevisions, eq, lte, user } from '@kenresoft/database';
import type { Database, Entry, EntryRevision, NewEntry } from '@kenresoft/database';

export interface EntryWithContentType extends Entry {
  contentTypeName: string;
  contentTypeSlug: string;
  authorName: string | null;
  authorEmail: string | null;
}

type EntryWriteInput = {
  slug?: NewEntry['slug'] | undefined;
  status?: NewEntry['status'] | undefined;
  data?: NewEntry['data'] | undefined;
  publishAt?: NewEntry['publishAt'] | undefined;
};

async function snapshotRevision(
  db: Database,
  entry: Pick<Entry, 'id' | 'slug' | 'status' | 'data'>,
  createdBy: string | null,
): Promise<void> {
  await db.insert(entryRevisions).values({
    entryId: entry.id,
    slug: entry.slug,
    status: entry.status,
    data: entry.data,
    createdBy,
  });
}

export async function createEntry(
  db: Database,
  contentTypeId: string,
  input: Pick<NewEntry, 'slug' | 'status' | 'data'> & Pick<EntryWriteInput, 'publishAt'>,
  createdBy: string | null,
): Promise<Entry> {
  const contentType = await db.query.contentTypes.findFirst({
    where: eq(contentTypes.id, contentTypeId),
  });
  if (!contentType) {
    throw new Error(`Content type ${contentTypeId} not found`);
  }

  const [entry] = await db
    .insert(entries)
    .values({ ...input, contentTypeId, createdBy })
    .returning();
  await snapshotRevision(db, entry!, createdBy);
  return entry!;
}

// Backs both the per-content-type Entries page and the unified admin "all entries" listing —
// the same joined shape (content type name/slug, author name/email — both nullable: a
// system-triggered write, e.g. the scheduled-publish Cron Trigger, has no acting user)
// either way, so both screens can show an Author column, not just the unified one. Pass
// contentTypeId to scope to one content type; omit it for every entry across every type.
export function listEntriesWithContentType(
  db: Database,
  contentTypeId?: string,
): Promise<EntryWithContentType[]> {
  return db
    .select({
      id: entries.id,
      contentTypeId: entries.contentTypeId,
      slug: entries.slug,
      status: entries.status,
      data: entries.data,
      publishAt: entries.publishAt,
      createdAt: entries.createdAt,
      updatedAt: entries.updatedAt,
      createdBy: entries.createdBy,
      contentTypeName: contentTypes.name,
      contentTypeSlug: contentTypes.slug,
      authorName: user.name,
      authorEmail: user.email,
    })
    .from(entries)
    .innerJoin(contentTypes, eq(entries.contentTypeId, contentTypes.id))
    .leftJoin(user, eq(entries.createdBy, user.id))
    .where(contentTypeId ? eq(entries.contentTypeId, contentTypeId) : undefined)
    .orderBy(desc(entries.updatedAt));
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

// Public content API (§8) — only ever surfaces published entries, regardless of what the
// caller asks for by slug. A draft matching the requested slug 404s exactly like a slug that
// doesn't exist at all, so the public API never leaks draft content's existence.
export function listPublishedEntriesForContentType(
  db: Database,
  contentTypeId: string,
): Promise<Entry[]> {
  return db.query.entries.findMany({
    where: and(eq(entries.contentTypeId, contentTypeId), eq(entries.status, 'published')),
  });
}

export function getPublishedEntryBySlug(
  db: Database,
  contentTypeId: string,
  slug: string,
): Promise<Entry | undefined> {
  return db.query.entries.findFirst({
    where: and(
      eq(entries.contentTypeId, contentTypeId),
      eq(entries.slug, slug),
      eq(entries.status, 'published'),
    ),
  });
}

export function getEntryById(db: Database, id: string): Promise<Entry | undefined> {
  return db.query.entries.findFirst({ where: eq(entries.id, id) });
}

// Snapshots the entry's current (about-to-be-overwritten) state as a revision before
// applying the update, so there's always something to restore to (§13).
export async function updateEntry(
  db: Database,
  id: string,
  input: EntryWriteInput,
  updatedBy: string | null,
): Promise<Entry | undefined> {
  const current = await db.query.entries.findFirst({ where: eq(entries.id, id) });
  if (!current) return undefined;

  await snapshotRevision(db, current, updatedBy);

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

export function listEntryRevisions(db: Database, entryId: string): Promise<EntryRevision[]> {
  return db.query.entryRevisions.findMany({
    where: eq(entryRevisions.entryId, entryId),
    orderBy: desc(entryRevisions.createdAt),
  });
}

// Reuses updateEntry so the restore itself snapshots the pre-restore state too — restoring
// is never a dead end.
export async function restoreEntryRevision(
  db: Database,
  entryId: string,
  revisionId: string,
  restoredBy: string | null,
): Promise<Entry | undefined> {
  const revision = await db.query.entryRevisions.findFirst({
    where: and(eq(entryRevisions.id, revisionId), eq(entryRevisions.entryId, entryId)),
  });
  if (!revision) return undefined;

  return updateEntry(
    db,
    entryId,
    { slug: revision.slug, status: revision.status, data: revision.data },
    restoredBy,
  );
}

// Scanned by the scheduled-publishing Cron Trigger (§13): draft entries whose publishAt has
// elapsed. Goes through updateEntry (createdBy: null — no user initiated this) so each
// auto-publish is itself snapshotted as a revision, same as any other write.
export async function publishDueEntries(db: Database): Promise<Entry[]> {
  const due = await db.query.entries.findMany({
    where: and(eq(entries.status, 'draft'), lte(entries.publishAt, new Date())),
  });

  const published: Entry[] = [];
  for (const entry of due) {
    const updated = await updateEntry(db, entry.id, { status: 'published' }, null);
    if (updated) published.push(updated);
  }
  return published;
}
