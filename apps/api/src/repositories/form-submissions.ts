import { and, asc, desc, eq, formSubmissionStageChanges, formSubmissions, forms, user } from '@kenresoft-cms/database';
import type { Database, FormSubmission, FormSubmissionStatus, NewFormSubmission } from '@kenresoft-cms/database';

export async function createFormSubmission(
  db: Database,
  input: Pick<NewFormSubmission, 'formId' | 'data' | 'isTest' | 'accountUserId' | 'stage'>,
): Promise<FormSubmission> {
  const [submission] = await db.insert(formSubmissions).values(input).returning();
  return submission!;
}

// Backs both the per-form Submissions page and the unified admin "all submissions" listing —
// the same joined shape (form name/slug) either way, matching listEntriesWithContentType's
// precedent (apps/api/src/repositories/entries.ts). Pass formId to scope to one form; omit it
// for every submission across every form. The owning account (if any) is joined in so staff
// can see who a submission belongs to.
export function listSubmissionsWithForm(db: Database, formId?: string) {
  return db
    .select({
      id: formSubmissions.id,
      formId: formSubmissions.formId,
      data: formSubmissions.data,
      status: formSubmissions.status,
      isTest: formSubmissions.isTest,
      accountUserId: formSubmissions.accountUserId,
      stage: formSubmissions.stage,
      createdAt: formSubmissions.createdAt,
      formName: forms.name,
      formSlug: forms.slug,
      accountName: user.name,
      accountEmail: user.email,
    })
    .from(formSubmissions)
    .innerJoin(forms, eq(formSubmissions.formId, forms.id))
    .leftJoin(user, eq(formSubmissions.accountUserId, user.id))
    .where(formId ? eq(formSubmissions.formId, formId) : undefined)
    .orderBy(desc(formSubmissions.createdAt));
}

// Every submission one account owns, newest first, optionally narrowed to one form. Test
// submissions never belong to an account view.
export function listAccountSubmissions(db: Database, accountUserId: string, formSlug?: string) {
  return db
    .select({
      submission: formSubmissions,
      formName: forms.name,
      formSlug: forms.slug,
      stages: forms.stages,
    })
    .from(formSubmissions)
    .innerJoin(forms, eq(formSubmissions.formId, forms.id))
    .where(
      and(
        eq(formSubmissions.accountUserId, accountUserId),
        eq(formSubmissions.isTest, false),
        formSlug ? eq(forms.slug, formSlug) : undefined,
      ),
    )
    .orderBy(desc(formSubmissions.createdAt));
}

// The one lookup every account route goes through: a submission the given account owns, or
// nothing. Ownership is part of the query itself, so another account's id is
// indistinguishable from an id that doesn't exist.
export async function getAccountSubmission(db: Database, accountUserId: string, submissionId: string) {
  const [row] = await db
    .select({ submission: formSubmissions, form: forms })
    .from(formSubmissions)
    .innerJoin(forms, eq(formSubmissions.formId, forms.id))
    .where(
      and(
        eq(formSubmissions.id, submissionId),
        eq(formSubmissions.accountUserId, accountUserId),
        eq(formSubmissions.isTest, false),
      ),
    );
  return row;
}

export function getFormSubmissionById(db: Database, id: string) {
  return db.query.formSubmissions.findFirst({ where: eq(formSubmissions.id, id) });
}

// Used once, right after a submission with file fields is created — a file's real Media
// reference isn't known until after upload, which itself needs the submission's own id
// (media_attachments.ownerId), so the submission is created first with its file fields
// omitted, then patched in here. Not a general-purpose "edit a submission" API.
export async function updateFormSubmissionData(
  db: Database,
  id: string,
  data: Record<string, unknown>,
): Promise<FormSubmission> {
  const [row] = await db.update(formSubmissions).set({ data }).where(eq(formSubmissions.id, id)).returning();
  return row!;
}

export async function updateFormSubmissionStatus(
  db: Database,
  id: string,
  status: FormSubmissionStatus,
): Promise<FormSubmission> {
  const [row] = await db.update(formSubmissions).set({ status }).where(eq(formSubmissions.id, id)).returning();
  return row!;
}

export async function updateFormSubmissionStage(
  db: Database,
  id: string,
  stage: string,
  changedByUserId: string,
): Promise<FormSubmission> {
  const [row] = await db.update(formSubmissions).set({ stage }).where(eq(formSubmissions.id, id)).returning();
  await recordStageChange(db, id, stage, changedByUserId);
  return row!;
}

export async function recordStageChange(
  db: Database,
  submissionId: string,
  stage: string,
  changedByUserId: string | null,
): Promise<void> {
  await db.insert(formSubmissionStageChanges).values({ submissionId, stage, changedByUserId });
}

export function listStageChanges(db: Database, submissionId: string) {
  return db
    .select({ stage: formSubmissionStageChanges.stage, createdAt: formSubmissionStageChanges.createdAt })
    .from(formSubmissionStageChanges)
    .where(eq(formSubmissionStageChanges.submissionId, submissionId))
    .orderBy(asc(formSubmissionStageChanges.createdAt));
}

export async function deleteFormSubmission(db: Database, id: string): Promise<void> {
  await db.delete(formSubmissions).where(eq(formSubmissions.id, id));
}
