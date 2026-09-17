import { and, asc, eq, entries, entryFolders, isNull } from '@kenresoft-cms/database';
import type { Database, Entry, EntryFolder, NewEntryFolder } from '@kenresoft-cms/database';

export function listEntryFoldersForContentType(db: Database, contentTypeId: string): Promise<EntryFolder[]> {
  return db.query.entryFolders.findMany({
    where: eq(entryFolders.contentTypeId, contentTypeId),
    orderBy: asc(entryFolders.name),
  });
}

export function getEntryFolderById(db: Database, id: string): Promise<EntryFolder | undefined> {
  return db.query.entryFolders.findFirst({ where: eq(entryFolders.id, id) });
}

export function getEntryFolderByName(
  db: Database,
  contentTypeId: string,
  parentId: string | null,
  name: string,
): Promise<EntryFolder | undefined> {
  return db.query.entryFolders.findFirst({
    where: and(
      eq(entryFolders.contentTypeId, contentTypeId),
      parentId === null ? isNull(entryFolders.parentId) : eq(entryFolders.parentId, parentId),
      eq(entryFolders.name, name),
    ),
  });
}

export async function createEntryFolder(
  db: Database,
  input: Pick<NewEntryFolder, 'contentTypeId' | 'name' | 'parentId'>,
): Promise<EntryFolder> {
  const [row] = await db.insert(entryFolders).values(input).returning();
  return row!;
}

export async function updateEntryFolder(
  db: Database,
  id: string,
  input: { name?: string | undefined; parentId?: string | null | undefined },
): Promise<EntryFolder | undefined> {
  const [row] = await db.update(entryFolders).set(input).where(eq(entryFolders.id, id)).returning();
  return row;
}

// Entries in this folder are never deleted along with it — the FK's onDelete: 'set null'
// (packages/database/schema/entries.ts) means every entry simply becomes unfiled again, and
// any child folders are reparented to root by their own FK's onDelete: 'set null'.
export async function deleteEntryFolder(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(entryFolders).where(eq(entryFolders.id, id)).returning({ id: entryFolders.id });
  return Boolean(deleted);
}

// Bulk-move — moves every given entry into (or, with folderId null, out of) a folder in one
// batch write. The caller is responsible for confirming every id actually belongs to the
// content type this folder belongs to before calling this (routes/admin/entry-folders.ts does).
export async function moveEntriesToFolder(
  db: Database,
  entryIds: string[],
  folderId: string | null,
): Promise<Entry[]> {
  const rows: Entry[] = [];
  // Sequential, not a single `WHERE id IN (...)` update — this project's other bulk-move
  // (moveMediaSchema's own repository function) also writes one D1 statement at a time rather
  // than assembling a giant IN-list, and entryIds is capped at 500 by moveEntriesSchema so this
  // stays bounded.
  for (const id of entryIds) {
    const [row] = await db
      .update(entries)
      .set({ folderId, updatedAt: new Date() })
      .where(eq(entries.id, id))
      .returning();
    if (row) rows.push(row);
  }
  return rows;
}

// A folder's full ancestor chain, root-first — backs breadcrumb rendering
// (Content type → … → this folder). Walks parentId pointers one row at a time; entry-folder
// trees are expected to be shallow (a handful of levels at most for a real editorial workflow),
// so this is simpler and clearer than a recursive CTE for the same result.
export async function getEntryFolderAncestors(db: Database, folderId: string): Promise<EntryFolder[]> {
  const chain: EntryFolder[] = [];
  let currentId: string | null = folderId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = await getEntryFolderById(db, currentId);
    if (!folder) break;
    chain.unshift(folder);
    currentId = folder.parentId;
  }
  return chain;
}
