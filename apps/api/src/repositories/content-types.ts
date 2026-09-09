import { contentTypes, eq } from '@kenresoft-cms/database';
import type { UpdateContentTypeInput } from '@kenresoft-cms/contracts';
import type { ContentType, Database, NewContentType } from '@kenresoft-cms/database';

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

export async function updateContentType(
  db: Database,
  id: string,
  patch: UpdateContentTypeInput,
): Promise<ContentType | undefined> {
  const [contentType] = await db.update(contentTypes).set(patch).where(eq(contentTypes.id, id)).returning();
  return contentType;
}
