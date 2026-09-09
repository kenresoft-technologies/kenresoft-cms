import { asc, eq, formFields } from '@kenresoft-cms/database';
import type { UpdateFormFieldInput } from '@kenresoft-cms/contracts';
import type { Database, FormField, NewFormField } from '@kenresoft-cms/database';

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

export function getFormFieldById(db: Database, id: string): Promise<FormField | undefined> {
  return db.query.formFields.findFirst({ where: eq(formFields.id, id) });
}

export async function updateFormField(
  db: Database,
  id: string,
  patch: UpdateFormFieldInput,
): Promise<FormField | undefined> {
  const [field] = await db.update(formFields).set(patch).where(eq(formFields.id, id)).returning();
  return field;
}

export async function deleteFormField(db: Database, id: string): Promise<void> {
  await db.delete(formFields).where(eq(formFields.id, id));
}
