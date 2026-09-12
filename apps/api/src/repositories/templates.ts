import { desc, eq, templates } from '@kenresoft-cms/database';
import type { Database, NewTemplate, Template } from '@kenresoft-cms/database';

type TemplateWriteInput = {
  name?: NewTemplate['name'] | undefined;
  contentTypeId?: NewTemplate['contentTypeId'] | undefined;
  blocks?: NewTemplate['blocks'] | undefined;
  isDefault?: NewTemplate['isDefault'] | undefined;
};

export async function createTemplate(
  db: Database,
  input: Pick<NewTemplate, 'name' | 'blocks'> & Pick<TemplateWriteInput, 'contentTypeId' | 'isDefault'>,
): Promise<Template> {
  const [template] = await db.insert(templates).values(input).returning();
  return template!;
}

export function listTemplates(db: Database): Promise<Template[]> {
  return db.query.templates.findMany({ orderBy: desc(templates.updatedAt) });
}

export function getTemplateById(db: Database, id: string): Promise<Template | undefined> {
  return db.query.templates.findFirst({ where: eq(templates.id, id) });
}

export async function updateTemplate(
  db: Database,
  id: string,
  patch: TemplateWriteInput,
): Promise<Template | undefined> {
  const [template] = await db
    .update(templates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(templates.id, id))
    .returning();
  return template;
}

export async function deleteTemplate(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(templates).where(eq(templates.id, id)).returning({ id: templates.id });
  return Boolean(deleted);
}
