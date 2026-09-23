import { and, contentTypes, desc, entries, entryRevisions, eq, isNull, lte, user } from '@kenresoft-cms/database';
import type { Database, Entry, EntryRevision, NewEntry } from '@kenresoft-cms/database';

import { sanitizeEntryDataForType } from '../lib/entry-html';

export interface EntryWithContentType extends Entry {
  contentTypeName: string;
  contentTypeSlug: string;
  authorName: string | null;
  authorEmail: string | null;
  folderId: string | null;
}

type EntryWriteInput = {
  slug?: NewEntry['slug'] | undefined;
  status?: NewEntry['status'] | undefined;
  data?: NewEntry['data'] | undefined;
  publishAt?: NewEntry['publishAt'] | undefined;
  folderId?: NewEntry['folderId'] | undefined;
  featured?: NewEntry['featured'] | undefined;
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
  input: Pick<NewEntry, 'slug' | 'status' | 'data'> & Pick<EntryWriteInput, 'publishAt' | 'folderId' | 'featured'>,
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
    .values({
      ...input,
      ...(input.data ? { data: await sanitizeEntryDataForType(db, contentTypeId, input.data) } : {}),
      contentTypeId,
      createdBy,
    })
    .returning();
  await snapshotRevision(db, entry!, createdBy);
  return entry!;
}

// entries.createdBy is `onDelete: 'set null'` — once a user is hard-deleted, the FK is gone
// for good, indistinguishable from an entry that never had an author (e.g. the scheduled-publish
// Cron Trigger's own writes). Rather than show a bare "—" either way, a deleted-user entry falls
// back to the deployment's current owner's name — the CMS always has exactly one, so it's a
// stable, meaningful attribution rather than a dead end. A genuinely system-authored entry
// (createdBy was already null) still shows the owner fallback too, by the same reasoning: there's
// no way to tell the two cases apart once the FK is gone, and "owner" is a reasonable default for
// both.
async function resolveFallbackAuthorName(db: Database): Promise<string | null> {
  const owner = await db.query.user.findFirst({
    where: eq(user.role, 'owner'),
    columns: { name: true },
  });
  return owner?.name ?? null;
}

// Backs both the per-content-type Entries page and the unified admin "all entries" listing —
// the same joined shape (content type name/slug, author name/email — both nullable) either way,
// so both screens can show an Author column, not just the unified one. Pass contentTypeId to
// scope to one content type; omit it for every entry across every type. folderId follows the
// same three-state convention as Media's own listMedia: undefined = every folder (no filter),
// null = unfiled/root only, a string = entries in that one folder.
export async function listEntriesWithContentType(
  db: Database,
  contentTypeId?: string,
  folderId?: string | null,
  featured?: boolean,
): Promise<EntryWithContentType[]> {
  const rows = await db
    .select({
      id: entries.id,
      contentTypeId: entries.contentTypeId,
      slug: entries.slug,
      status: entries.status,
      data: entries.data,
      publishAt: entries.publishAt,
      featured: entries.featured,
      createdAt: entries.createdAt,
      updatedAt: entries.updatedAt,
      createdBy: entries.createdBy,
      folderId: entries.folderId,
      contentTypeName: contentTypes.name,
      contentTypeSlug: contentTypes.slug,
      authorName: user.name,
      authorEmail: user.email,
    })
    .from(entries)
    .innerJoin(contentTypes, eq(entries.contentTypeId, contentTypes.id))
    .leftJoin(user, eq(entries.createdBy, user.id))
    .where(
      and(
        contentTypeId ? eq(entries.contentTypeId, contentTypeId) : undefined,
        folderId === undefined ? undefined : folderId === null ? isNull(entries.folderId) : eq(entries.folderId, folderId),
        featured === undefined ? undefined : eq(entries.featured, featured),
      ),
    )
    .orderBy(desc(entries.updatedAt));

  if (rows.every((row) => row.authorName !== null)) return rows;

  const fallbackName = await resolveFallbackAuthorName(db);
  if (!fallbackName) return rows;
  return rows.map((row) => (row.authorName === null ? { ...row, authorName: fallbackName } : row));
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
  featuredOnly?: boolean,
): Promise<Entry[]> {
  return db.query.entries.findMany({
    where: and(
      eq(entries.contentTypeId, contentTypeId),
      eq(entries.status, 'published'),
      featuredOnly ? eq(entries.featured, true) : undefined,
    ),
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
    .set({
      ...input,
      ...(input.data ? { data: await sanitizeEntryDataForType(db, current.contentTypeId, input.data) } : {}),
      updatedAt: new Date(),
    })
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

// Deliberately unconditional and irreversible — the entry itself is untouched, only its history.
export async function clearEntryRevisions(db: Database, entryId: string): Promise<void> {
  await db.delete(entryRevisions).where(eq(entryRevisions.entryId, entryId));
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
