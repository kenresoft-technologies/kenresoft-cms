import { contentTypes, count, entries, eq, fieldDefinitions, isNotNull } from '@kenresoft-cms/database';
import type { UpdateContentTypeInput } from '@kenresoft-cms/contracts';
import type { ContentType, Database, NewContentType } from '@kenresoft-cms/database';

export interface ContentTypeWithCounts extends ContentType {
  fieldCount: number;
  entryCount: number;
}

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

// Backs the Content Types grid view (§2 of the organization/navigation UX pass) — exactly two
// aggregate queries regardless of how many content types exist, never N+1 (the old admin UI's
// own per-row FieldsCountCell issued one field-list request per row on the table view, which
// this route/repository function replaces for the grid). Content types with zero fields/entries
// simply don't appear in the respective count map and default to 0 below.
export async function listContentTypesWithCounts(db: Database): Promise<ContentTypeWithCounts[]> {
  const [types, fieldCounts, entryCounts] = await Promise.all([
    db.query.contentTypes.findMany(),
    db
      .select({ contentTypeId: fieldDefinitions.contentTypeId, count: count() })
      .from(fieldDefinitions)
      .groupBy(fieldDefinitions.contentTypeId),
    db
      .select({ contentTypeId: entries.contentTypeId, count: count() })
      .from(entries)
      .groupBy(entries.contentTypeId),
  ]);

  const fieldCountById = new Map(fieldCounts.map((row) => [row.contentTypeId, row.count]));
  const entryCountById = new Map(entryCounts.map((row) => [row.contentTypeId, row.count]));

  return types.map((type) => ({
    ...type,
    fieldCount: fieldCountById.get(type.id) ?? 0,
    entryCount: entryCountById.get(type.id) ?? 0,
  }));
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
