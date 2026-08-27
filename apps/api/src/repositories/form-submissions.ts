import { desc, eq, formSubmissions } from '@kenresoft/database';
import type { Database, FormSubmission, FormSubmissionStatus, NewFormSubmission } from '@kenresoft/database';

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

export function getFormSubmissionById(db: Database, id: string) {
  return db.query.formSubmissions.findFirst({ where: eq(formSubmissions.id, id) });
}

export async function updateFormSubmissionStatus(
  db: Database,
  id: string,
  status: FormSubmissionStatus,
): Promise<FormSubmission> {
  const [row] = await db.update(formSubmissions).set({ status }).where(eq(formSubmissions.id, id)).returning();
  return row!;
}
