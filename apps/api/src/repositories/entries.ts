import { and, contentTypes, desc, entries, entryRevisions, eq, isNull, lte, ne, user } from '@kenresoft-cms/database';
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

  const insert = db
    .insert(entries)
    .values({
      ...input,
      ...(input.data ? { data: await sanitizeEntryDataForType(db, contentTypeId, input.data) } : {}),
      contentTypeId,
      createdBy,
    })
    .returning();
  let entry: Entry | undefined;
  if (input.featured === true && contentType.singleFeatured) {
    // The new entry doesn't exist yet, so "every other" is every currently featured one.
    const [, inserted] = await db.batch([unfeatureQuery(db, contentTypeId), insert]);
    entry = inserted[0];
  } else {
    [entry] = await insert;
  }
  await snapshotRevision(db, entry!, createdBy);
  return entry!;
}

// A content type with "Only one featured entry" (contentTypes.singleFeatured) never has more than
// one featured entry: featuring one un-features the rest *in the same D1 batch* as the write, so
// two editors featuring different entries at the same moment still end with exactly one featured
// (the last batch to run), never zero or two. updatedAt is deliberately left alone on the entries
// un-featured this way — they weren't edited, and bumping it would reorder "recently updated".
function unfeatureQuery(db: Database, contentTypeId: string, exceptEntryId?: string) {
  return db
    .update(entries)
    .set({ featured: false })
    .where(
      and(
        eq(entries.contentTypeId, contentTypeId),
        eq(entries.featured, true),
        exceptEntryId ? ne(entries.id, exceptEntryId) : undefined,
      ),
    );
}

// The featured entries a write featuring `entryId` (undefined for a new entry) would un-feature,
// so the caller can clear their public-cache copies too. Empty unless the content type has
// "Only one featured entry" on.
export async function listEntriesToUnfeature(
  db: Database,
  contentTypeId: string,
  entryId?: string,
): Promise<Pick<Entry, 'id' | 'slug'>[]> {
  const contentType = await db.query.contentTypes.findFirst({ where: eq(contentTypes.id, contentTypeId) });
  if (!contentType?.singleFeatured) return [];
  return db
    .select({ id: entries.id, slug: entries.slug })
    .from(entries)
    .where(
      and(
        eq(entries.contentTypeId, contentTypeId),
        eq(entries.featured, true),
        entryId ? ne(entries.id, entryId) : undefined,
      ),
    );
}

// Turning "Only one featured entry" on for a content type that already has several featured
// entries: the most recently updated one stays featured, the rest are un-featured in one batch.
// Returns the un-featured entries (for cache invalidation and the audit log).
export async function keepOnlyLatestFeatured(
  db: Database,
  contentTypeId: string,
): Promise<Pick<Entry, 'id' | 'slug'>[]> {
  const featured = await db
    .select({ id: entries.id, slug: entries.slug })
    .from(entries)
    .where(and(eq(entries.contentTypeId, contentTypeId), eq(entries.featured, true)))
    .orderBy(desc(entries.updatedAt));
  if (featured.length <= 1) return [];
  const [keep, ...rest] = featured;
  await unfeatureQuery(db, contentTypeId, keep!.id);
  return rest;
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

  const update = db
    .update(entries)
    .set({
      ...input,
      ...(input.data ? { data: await sanitizeEntryDataForType(db, current.contentTypeId, input.data) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(entries.id, id))
    .returning();
  if (input.featured === true) {
    const contentType = await db.query.contentTypes.findFirst({
      where: eq(contentTypes.id, current.contentTypeId),
    });
    if (contentType?.singleFeatured) {
      const [, updated] = await db.batch([unfeatureQuery(db, current.contentTypeId, id), update]);
      return updated[0];
    }
  }
  const [entry] = await update;
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
