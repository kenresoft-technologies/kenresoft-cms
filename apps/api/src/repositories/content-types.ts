import { and, contentTypes, eq } from '@kenresoft/database';
import type { ContentType, Database, NewContentType } from '@kenresoft/database';

export async function createContentType(
  db: Database,
  input: Pick<NewContentType, 'projectId' | 'name' | 'slug' | 'description'>,
): Promise<ContentType> {
  const [contentType] = await db.insert(contentTypes).values(input).returning();
  return contentType!;
}

export function listContentTypesForProject(
  db: Database,
  projectId: string,
): Promise<ContentType[]> {
  return db.query.contentTypes.findMany({ where: eq(contentTypes.projectId, projectId) });
}

export function getContentTypeBySlug(
  db: Database,
  projectId: string,
  slug: string,
): Promise<ContentType | undefined> {
  return db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.projectId, projectId), eq(contentTypes.slug, slug)),
  });
}

export function getContentTypeById(
  db: Database,
  id: string,
): Promise<ContentType | undefined> {
  return db.query.contentTypes.findFirst({ where: eq(contentTypes.id, id) });
}
