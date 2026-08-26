import { desc, eq, formSubmissions } from '@kenresoft/database';
import type { Database, FormSubmission, NewFormSubmission } from '@kenresoft/database';

export async function createFormSubmission(
  db: Database,
  input: Pick<NewFormSubmission, 'formId' | 'data'>,
): Promise<FormSubmission> {
  const [submission] = await db.insert(formSubmissions).values(input).returning();
  return submission!;
}

export function listFormSubmissions(db: Database, formId: string): Promise<FormSubmission[]> {
  return db.query.formSubmissions.findMany({
    where: eq(formSubmissions.formId, formId),
    orderBy: desc(formSubmissions.createdAt),
  });
}
