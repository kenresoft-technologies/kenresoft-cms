import { and, eq, mediaAttachments } from '@kenresoft-cms/database';
import type { Database, MediaAttachment, NewMediaAttachment } from '@kenresoft-cms/database';

export async function createMediaAttachment(
  db: Database,
  input: Pick<NewMediaAttachment, 'mediaId' | 'ownerType' | 'ownerId' | 'fieldName'>,
): Promise<MediaAttachment> {
  const [row] = await db.insert(mediaAttachments).values(input).returning();
  return row!;
}

export function listAttachmentsForOwner(db: Database, ownerType: string, ownerId: string): Promise<MediaAttachment[]> {
  return db.query.mediaAttachments.findMany({
    where: and(eq(mediaAttachments.ownerType, ownerType), eq(mediaAttachments.ownerId, ownerId)),
  });
}

// Used to decide whether a Media row is still referenced by anything before physically deleting
// it — an owner's own relationship can be removed without deleting a Media asset that another
// owner still points at (Phase 5's explicit reference-counted deletion requirement).
export function countAttachmentsForMedia(db: Database, mediaId: string): Promise<MediaAttachment[]> {
  return db.query.mediaAttachments.findMany({ where: eq(mediaAttachments.mediaId, mediaId) });
}

export async function deleteAttachment(db: Database, id: string): Promise<void> {
  await db.delete(mediaAttachments).where(eq(mediaAttachments.id, id));
}

export async function deleteAttachmentsForOwner(
  db: Database,
  ownerType: string,
  ownerId: string,
): Promise<MediaAttachment[]> {
  return db
    .delete(mediaAttachments)
    .where(and(eq(mediaAttachments.ownerType, ownerType), eq(mediaAttachments.ownerId, ownerId)))
    .returning();
}
