import { desc, eq, media } from '@kenresoft-cms/database';
import type { Database, Media, NewMedia } from '@kenresoft-cms/database';

export async function createMedia(
  db: Database,
  input: Pick<NewMedia, 'key' | 'filename' | 'contentType' | 'size' | 'width' | 'height' | 'altText'>,
): Promise<Media> {
  const [row] = await db.insert(media).values(input).returning();
  return row!;
}

export function listMedia(db: Database): Promise<Media[]> {
  return db.query.media.findMany({ orderBy: desc(media.createdAt) });
}

export function getMediaById(db: Database, id: string): Promise<Media | undefined> {
  return db.query.media.findFirst({ where: eq(media.id, id) });
}

export async function deleteMedia(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(media).where(eq(media.id, id)).returning({ id: media.id });
  return Boolean(deleted);
}
