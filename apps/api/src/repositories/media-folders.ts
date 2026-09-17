import { asc, eq, mediaFolders } from '@kenresoft-cms/database';
import type { Database, MediaFolder, NewMediaFolder } from '@kenresoft-cms/database';

export function listMediaFolders(db: Database): Promise<MediaFolder[]> {
  return db.query.mediaFolders.findMany({ orderBy: asc(mediaFolders.name) });
}

export function getMediaFolderById(db: Database, id: string): Promise<MediaFolder | undefined> {
  return db.query.mediaFolders.findFirst({ where: eq(mediaFolders.id, id) });
}

export function getMediaFolderBySlug(db: Database, slug: string): Promise<MediaFolder | undefined> {
  return db.query.mediaFolders.findFirst({ where: eq(mediaFolders.slug, slug) });
}

export async function createMediaFolder(
  db: Database,
  input: Pick<NewMediaFolder, 'name' | 'slug'> & { parentId?: string | null | undefined },
): Promise<MediaFolder> {
  const [row] = await db.insert(mediaFolders).values(input).returning();
  return row!;
}

export async function updateMediaFolder(
  db: Database,
  id: string,
  input: { name?: string | undefined; slug?: string | undefined; parentId?: string | null | undefined },
): Promise<MediaFolder | undefined> {
  const [row] = await db.update(mediaFolders).set(input).where(eq(mediaFolders.id, id)).returning();
  return row;
}

// A folder's full ancestor chain, root-first — backs breadcrumb rendering in the Media Library
// (Media → Website → Home → Hero). Mirrors getEntryFolderAncestors's own walk-the-parentId-chain
// approach exactly.
export async function getMediaFolderAncestors(db: Database, folderId: string): Promise<MediaFolder[]> {
  const chain: MediaFolder[] = [];
  let currentId: string | null = folderId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = await getMediaFolderById(db, currentId);
    if (!folder) break;
    chain.unshift(folder);
    currentId = folder.parentId;
  }
  return chain;
}

// Media in this folder is never deleted along with it — the FK's onDelete: 'set null'
// (packages/database/schema/media.ts) means every file simply becomes unfiled again.
export async function deleteMediaFolder(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(mediaFolders).where(eq(mediaFolders.id, id)).returning({ id: mediaFolders.id });
  return Boolean(deleted);
}
