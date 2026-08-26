import { asc, eq } from 'drizzle-orm';
import { fieldDefinitions } from '@kenresoft/database';
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
