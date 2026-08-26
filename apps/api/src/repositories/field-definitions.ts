import { asc, eq, fieldDefinitions } from '@kenresoft/database';
import type { Database, FieldDefinition, NewFieldDefinition } from '@kenresoft/database';

export async function createFieldDefinition(
  db: Database,
  input: Pick<
    NewFieldDefinition,
    'contentTypeId' | 'name' | 'label' | 'fieldType' | 'required' | 'sortOrder' | 'config'
  >,
): Promise<FieldDefinition> {
  const [field] = await db.insert(fieldDefinitions).values(input).returning();
  return field!;
}

export function listFieldDefinitionsForContentType(
  db: Database,
  contentTypeId: string,
): Promise<FieldDefinition[]> {
  return db.query.fieldDefinitions.findMany({
    where: eq(fieldDefinitions.contentTypeId, contentTypeId),
    orderBy: asc(fieldDefinitions.sortOrder),
  });
}

// Sets each field's sortOrder to its index in `fieldIds` (§6.1 — the entry editor renders
// fields in this order). Requires fieldIds to be exactly the content type's current field
// ids, just reordered — rejects a stale or foreign id rather than silently dropping or
// reordering fields that don't belong to this content type.
export async function reorderFieldDefinitions(
  db: Database,
  contentTypeId: string,
  fieldIds: string[],
): Promise<FieldDefinition[]> {
  const existing = await listFieldDefinitionsForContentType(db, contentTypeId);
  const existingIds = new Set(existing.map((field) => field.id));
  const isExactMatch = fieldIds.length === existing.length && fieldIds.every((id) => existingIds.has(id));
  if (!isExactMatch) {
    throw new Error('fieldIds must exactly match this content type\'s existing fields');
  }

  await Promise.all(
    fieldIds.map((id, index) =>
      db.update(fieldDefinitions).set({ sortOrder: index }).where(eq(fieldDefinitions.id, id)),
    ),
  );

  return listFieldDefinitionsForContentType(db, contentTypeId);
}
