import { and, desc, eq, inArray, isNull, media } from '@kenresoft-cms/database';
import type { Database, Media, MediaVisibility, NewMedia } from '@kenresoft-cms/database';

export async function createMedia(
  db: Database,
  input: Pick<
    NewMedia,
    'key' | 'filename' | 'contentType' | 'size' | 'width' | 'height' | 'altText' | 'folderId' | 'visibility'
  >,
): Promise<Media> {
  const [row] = await db.insert(media).values(input).returning();
  return row!;
}

// `folderId === undefined` means "every folder" (the default library view); `null` means
// "unfiled only"; a real id scopes to just that folder — three distinct states, not
// collapsible into one optional-string param. `includePrivate` defaults to false — the safe
// default for both the public API (which must NEVER include a private row) and the admin Media
// Library's own default grid (visitor/submission attachments belong on their owning resource's
// detail view, not the general library — Phase 5's decision). Enforced here, at the query layer,
// rather than left to every caller to remember its own filter.
export function listMedia(
  db: Database,
  folderId?: string | null,
  options?: { includePrivate?: boolean },
): Promise<Media[]> {
  const conditions = [];
  if (folderId !== undefined) {
    conditions.push(folderId === null ? isNull(media.folderId) : eq(media.folderId, folderId));
  }
  if (!options?.includePrivate) {
    conditions.push(eq(media.visibility, 'public'));
  }
  return db.query.media.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: desc(media.createdAt),
  });
}

export function getMediaById(db: Database, id: string): Promise<Media | undefined> {
  return db.query.media.findFirst({ where: eq(media.id, id) });
}

// The only Media lookup the public API may ever use — a private asset must be structurally
// absent from the result, not filtered after the fact by a route-level check an author could
// forget (Phase 5's explicit security requirement: a private asset must behave, from the public
// API's perspective, as though it does not exist at all).
export function getPublicMediaById(db: Database, id: string): Promise<Media | undefined> {
  return db.query.media.findFirst({ where: and(eq(media.id, id), eq(media.visibility, 'public')) });
}

export async function updateMedia(
  db: Database,
  id: string,
  input: { filename?: string | undefined; altText?: string | null | undefined; visibility?: MediaVisibility | undefined },
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
