import { contentTypes, eq } from '@kenresoft/database';
import type { ContentType, Database, NewContentType } from '@kenresoft/database';

export async function createContentType(
  db: Database,
  input: Pick<NewContentType, 'name' | 'slug' | 'description'>,
): Promise<ContentType> {
  const [contentType] = await db.insert(contentTypes).values(input).returning();
  return contentType!;
}

export function listContentTypes(db: Database): Promise<ContentType[]> {
  return db.query.contentTypes.findMany();
}

export function getContentTypeBySlug(db: Database, slug: string): Promise<ContentType | undefined> {
  return db.query.contentTypes.findFirst({ where: eq(contentTypes.slug, slug) });
}

export function getContentTypeById(
  db: Database,
  id: string,
): Promise<ContentType | undefined> {
  return db.query.contentTypes.findFirst({ where: eq(contentTypes.id, id) });
}
