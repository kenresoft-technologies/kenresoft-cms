import { eq, forms } from '@kenresoft/database';
import type { UpdateFormInput } from '@kenresoft/contracts';
import type { Database, Form, NewForm } from '@kenresoft/database';

export async function createForm(db: Database, input: Pick<NewForm, 'name' | 'slug'>): Promise<Form> {
  const [form] = await db.insert(forms).values(input).returning();
  return form!;
}

export function listForms(db: Database): Promise<Form[]> {
  return db.query.forms.findMany();
}

export function getFormById(db: Database, id: string): Promise<Form | undefined> {
  return db.query.forms.findFirst({ where: eq(forms.id, id) });
}

export function getFormBySlug(db: Database, slug: string): Promise<Form | undefined> {
  return db.query.forms.findFirst({ where: eq(forms.slug, slug) });
}

export async function updateForm(
  db: Database,
  id: string,
  patch: UpdateFormInput,
): Promise<Form | undefined> {
  const [form] = await db.update(forms).set(patch).where(eq(forms.id, id)).returning();
  return form;
}
