import { contentTypes, eq, isNotNull } from '@kenresoft-cms/database';
import type { UpdateContentTypeInput } from '@kenresoft-cms/contracts';
import type { ContentType, Database, NewContentType } from '@kenresoft-cms/database';

export async function createContentType(
  db: Database,
  input: Pick<NewContentType, 'name' | 'slug' | 'description' | 'routePattern'>,
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

// Phase 2 (docs/SITE_BUILDER.md) — the API layer's own pre-write "no duplicate/conflicting
// route patterns" check, checked before insert/update alongside the DB's own unique index
// (defense-in-depth: this gives a real 400 with a clear message instead of surfacing the
// index's own driver-level constraint error to the caller).
export function getContentTypeByRoutePattern(
  db: Database,
  routePattern: string,
): Promise<ContentType | undefined> {
  return db.query.contentTypes.findFirst({ where: eq(contentTypes.routePattern, routePattern) });
}

// Backs the public route-patterns listing (Phase 2) — every content type that has opted into
// a frontend route of its own.
export function listContentTypesWithRoutePattern(db: Database): Promise<ContentType[]> {
  return db.query.contentTypes.findMany({ where: isNotNull(contentTypes.routePattern) });
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
