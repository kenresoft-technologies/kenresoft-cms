import { desc, eq, inArray, isNull, media } from '@kenresoft-cms/database';
import type { Database, Media, NewMedia } from '@kenresoft-cms/database';

export async function createMedia(
  db: Database,
  input: Pick<NewMedia, 'key' | 'filename' | 'contentType' | 'size' | 'width' | 'height' | 'altText' | 'folderId'>,
): Promise<Media> {
  const [row] = await db.insert(media).values(input).returning();
  return row!;
}

// `folderId === undefined` means "every folder" (the default library view); `null` means
// "unfiled only"; a real id scopes to just that folder — three distinct states, not
// collapsible into one optional-string param.
export function listMedia(db: Database, folderId?: string | null): Promise<Media[]> {
  if (folderId === undefined) {
    return db.query.media.findMany({ orderBy: desc(media.createdAt) });
  }
  return db.query.media.findMany({
    where: folderId === null ? isNull(media.folderId) : eq(media.folderId, folderId),
    orderBy: desc(media.createdAt),
  });
}

export function getMediaById(db: Database, id: string): Promise<Media | undefined> {
  return db.query.media.findFirst({ where: eq(media.id, id) });
}

export async function updateMedia(
  db: Database,
  id: string,
  input: { filename?: string | undefined; altText?: string | null | undefined },
): Promise<Media | undefined> {
  if (Object.keys(input).length === 0) {
    return getMediaById(db, id);
  }
  const [row] = await db.update(media).set(input).where(eq(media.id, id)).returning();
  return row;
}

export async function deleteMedia(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(media).where(eq(media.id, id)).returning({ id: media.id });
  return Boolean(deleted);
}

// Bulk-moves a set of media items into a folder (or back to unfiled, `folderId: null`) — the
// Media Library's own multi-select "move to folder" action, backing a single UPDATE rather than
// N per-item PATCH calls.
export async function moveMediaToFolder(db: Database, mediaIds: string[], folderId: string | null): Promise<number> {
  const rows = await db.update(media).set({ folderId }).where(inArray(media.id, mediaIds)).returning({ id: media.id });
  return rows.length;
}
