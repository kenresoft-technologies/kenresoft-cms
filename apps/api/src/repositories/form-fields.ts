import { asc, eq, formFields } from '@kenresoft/database';
import type { Database, FormField, NewFormField } from '@kenresoft/database';

export async function createFormField(
  db: Database,
  input: Pick<NewFormField, 'formId' | 'name' | 'label' | 'fieldType' | 'required' | 'sortOrder' | 'config'>,
): Promise<FormField> {
  const [field] = await db.insert(formFields).values(input).returning();
  return field!;
}

export function listFormFields(db: Database, formId: string): Promise<FormField[]> {
  return db.query.formFields.findMany({
    where: eq(formFields.formId, formId),
    orderBy: asc(formFields.sortOrder),
  });
}
