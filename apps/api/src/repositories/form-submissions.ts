import { desc, eq, formSubmissions, forms } from '@kenresoft-cms/database';
import type { Database, FormSubmission, FormSubmissionStatus, NewFormSubmission } from '@kenresoft-cms/database';

export async function createFormSubmission(
  db: Database,
  input: Pick<NewFormSubmission, 'formId' | 'data'>,
): Promise<FormSubmission> {
  const [submission] = await db.insert(formSubmissions).values(input).returning();
  return submission!;
}

// Backs both the per-form Submissions page and the unified admin "all submissions" listing —
// the same joined shape (form name/slug) either way, matching listEntriesWithContentType's
// precedent (apps/api/src/repositories/entries.ts). Pass formId to scope to one form; omit it
// for every submission across every form.
export function listSubmissionsWithForm(db: Database, formId?: string) {
  return db
    .select({
      id: formSubmissions.id,
      formId: formSubmissions.formId,
      data: formSubmissions.data,
      status: formSubmissions.status,
      createdAt: formSubmissions.createdAt,
      formName: forms.name,
      formSlug: forms.slug,
    })
    .from(formSubmissions)
    .innerJoin(forms, eq(formSubmissions.formId, forms.id))
    .where(formId ? eq(formSubmissions.formId, formId) : undefined)
    .orderBy(desc(formSubmissions.createdAt));
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
