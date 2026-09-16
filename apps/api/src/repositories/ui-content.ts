import { and, asc, desc, eq, uiContentItems, uiContentTypes } from '@kenresoft-cms/database';
import type { Database, NewUiContentItem, NewUiContentType, UiContentItem, UiContentType } from '@kenresoft-cms/database';

export function listUiContentTypes(db: Database): Promise<UiContentType[]> {
  return db.query.uiContentTypes.findMany({ orderBy: asc(uiContentTypes.name) });
}

export function getUiContentTypeById(db: Database, id: string): Promise<UiContentType | undefined> {
  return db.query.uiContentTypes.findFirst({ where: eq(uiContentTypes.id, id) });
}

export function getUiContentTypeBySlug(db: Database, slug: string): Promise<UiContentType | undefined> {
  return db.query.uiContentTypes.findFirst({ where: eq(uiContentTypes.slug, slug) });
}

export async function createUiContentType(
  db: Database,
  input: Pick<NewUiContentType, 'name' | 'slug' | 'fields'>,
): Promise<UiContentType> {
  const [row] = await db.insert(uiContentTypes).values(input).returning();
  return row!;
}

export async function updateUiContentType(
  db: Database,
  id: string,
  input: {
    name?: string | undefined;
    slug?: string | undefined;
    fields?: NewUiContentType['fields'] | undefined;
  },
): Promise<UiContentType | undefined> {
  const [row] = await db.update(uiContentTypes).set(input).where(eq(uiContentTypes.id, id)).returning();
  return row;
}

// Items cascade-delete with their type (packages/database/schema/ui-content.ts) — no manual
// cleanup needed here.
export async function deleteUiContentType(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(uiContentTypes).where(eq(uiContentTypes.id, id)).returning({ id: uiContentTypes.id });
  return Boolean(deleted);
}

export function listUiContentItems(db: Database, uiContentTypeId: string): Promise<UiContentItem[]> {
  return db.query.uiContentItems.findMany({
    where: eq(uiContentItems.uiContentTypeId, uiContentTypeId),
    orderBy: desc(uiContentItems.createdAt),
  });
}

export function listEnabledUiContentItems(db: Database, uiContentTypeId: string): Promise<UiContentItem[]> {
  return db.query.uiContentItems.findMany({
    where: and(eq(uiContentItems.uiContentTypeId, uiContentTypeId), eq(uiContentItems.enabled, true)),
    orderBy: desc(uiContentItems.createdAt),
  });
}

export function getUiContentItemById(db: Database, id: string): Promise<UiContentItem | undefined> {
  return db.query.uiContentItems.findFirst({ where: eq(uiContentItems.id, id) });
}

export function getUiContentItemBySlug(
  db: Database,
  uiContentTypeId: string,
  slug: string,
): Promise<UiContentItem | undefined> {
  return db.query.uiContentItems.findFirst({
    where: and(eq(uiContentItems.uiContentTypeId, uiContentTypeId), eq(uiContentItems.slug, slug)),
  });
}

// Filters to enabled at the query layer — a disabled item 404s exactly like a nonexistent slug,
// the same "never distinguishable from the outside" convention Entries' draft/published split
// already established.
export function getEnabledUiContentItemBySlug(
  db: Database,
  uiContentTypeId: string,
  slug: string,
): Promise<UiContentItem | undefined> {
  return db.query.uiContentItems.findFirst({
    where: and(
      eq(uiContentItems.uiContentTypeId, uiContentTypeId),
      eq(uiContentItems.slug, slug),
      eq(uiContentItems.enabled, true),
    ),
  });
}

export async function createUiContentItem(
  db: Database,
  input: Pick<NewUiContentItem, 'uiContentTypeId' | 'slug' | 'data' | 'enabled'>,
): Promise<UiContentItem> {
  const [row] = await db.insert(uiContentItems).values(input).returning();
  return row!;
}

export async function updateUiContentItem(
  db: Database,
  id: string,
  input: {
    slug?: string | undefined;
    data?: NewUiContentItem['data'] | undefined;
    enabled?: boolean | undefined;
  },
): Promise<UiContentItem | undefined> {
  const [row] = await db.update(uiContentItems).set(input).where(eq(uiContentItems.id, id)).returning();
  return row;
}

export async function deleteUiContentItem(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(uiContentItems).where(eq(uiContentItems.id, id)).returning({ id: uiContentItems.id });
  return Boolean(deleted);
}
