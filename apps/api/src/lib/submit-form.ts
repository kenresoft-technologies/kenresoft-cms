import type { Database, Form, FormField, FormSubmission } from '@kenresoft-cms/database';

import { validateSubmission } from './form-submission-validation';
import { deleteMediaFile, uploadMedia } from './media-service';
import { createMediaAttachment } from '../repositories/media-attachments';
import { createFormSubmission, deleteFormSubmission, recordStageChange } from '../repositories/form-submissions';

// Shared by the public submission route (routes/public/forms.ts) and the admin "Preview & Test"
// route (routes/admin/forms.ts's test-submissions) — both need the exact same validate → store
// files → create-and-attach pipeline, just with a different `isTest` flag and different
// surrounding concerns (rate limiting, notification subject). Kept as one function so the two
// call sites can never silently drift on how a file field is attached to Media.

export interface ParsedSubmissionBody {
  body: unknown;
  uploadedFiles: Map<string, File>;
}

export type ParseSubmissionBodyResult = { ok: true; parsed: ParsedSubmissionBody } | { ok: false; error: string };

// A form with a `file` field can only be submitted as multipart/form-data — a file has no
// representation inside a JSON body. Every other form keeps working via plain JSON.
export async function parseSubmissionRequestBody(request: Request): Promise<ParseSubmissionBodyResult> {
  const contentType = request.headers.get('Content-Type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return { ok: false, error: 'Invalid multipart/form-data body' };
    }
    const plain: Record<string, unknown> = {};
    const uploadedFiles = new Map<string, File>();
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) uploadedFiles.set(key, value);
      else plain[key] = value;
    }
    return { ok: true, parsed: { body: plain, uploadedFiles } };
  }

  try {
    const body = await request.json();
    return { ok: true, parsed: { body, uploadedFiles: new Map() } };
  } catch {
    return { ok: false, error: 'Invalid JSON body' };
  }
}

export type SubmitFormResult =
  | { ok: true; submission: FormSubmission }
  // status 400: the visitor's input was invalid. status 500: a file or the submission itself could
  // not be stored; nothing was kept, so the visitor can safely try again.
  | { ok: false; status: 400 | 500; error: string; issues?: { path: PropertyKey[]; message: string }[] };

const STORAGE_FAILED = 'Your submission could not be saved. Nothing was sent, please try again.';

export async function submitForm(
  db: Database,
  bucket: R2Bucket,
  form: Pick<Form, 'id' | 'stages'>,
  fields: FormField[],
  parsed: ParsedSubmissionBody,
  // accountUserId comes only from the server-verified session, never from the request body.
  options: { isTest: boolean; accountUserId?: string | null },
): Promise<SubmitFormResult> {
  const validated = await validateSubmission(fields, parsed.body, parsed.uploadedFiles);
  if (validated.issues) {
    return { ok: false, status: 400, error: 'Validation failed', issues: validated.issues };
  }

  // Every submitted file becomes a real, private Media asset (Phase 5's "single canonical Media
  // table" decision) rather than a bare R2 object the CMS otherwise knows nothing about — never
  // shown in the admin Media Library's default grid (visibility: 'private'), reachable only
  // through the submission's own detail view.
  //
  // Files are stored first and the submission is created only once all of them are, already
  // holding their Media references. A successful result therefore always means every submitted
  // file exists as a private attachment. If any step fails, everything created so far is removed
  // (deleting a Media row also removes its media_attachments rows) and no submission is kept.
  const data: Record<string, unknown> = { ...validated.data };
  const stored: { fieldName: string; mediaId: string }[] = [];
  let submission: FormSubmission | null = null;
  try {
    for (const [fieldName, attachment] of Object.entries(validated.files ?? {})) {
      const uploadResult = await uploadMedia(db, bucket, {
        bytes: attachment.bytes,
        filename: attachment.filename,
        altText: null,
        visibility: 'private',
      });
      if (!uploadResult.ok) throw new Error(`File field "${fieldName}" could not be stored: ${uploadResult.error}`);
      stored.push({ fieldName, mediaId: uploadResult.media.id });
      data[fieldName] = {
        mediaId: uploadResult.media.id,
        filename: attachment.filename,
        size: attachment.bytes.byteLength,
        contentType: attachment.contentType,
      };
    }

    // A form with stages starts every submission in its first one, recorded as the first entry of
    // the progress history.
    const initialStage = form.stages?.[0] ?? null;
    submission = await createFormSubmission(db, {
      formId: form.id,
      data,
      isTest: options.isTest,
      accountUserId: options.accountUserId ?? null,
      stage: initialStage,
    });
    for (const { fieldName, mediaId } of stored) {
      await createMediaAttachment(db, { mediaId, ownerType: 'form_submission', ownerId: submission.id, fieldName });
    }
    if (initialStage) await recordStageChange(db, submission.id, initialStage, null);
  } catch (error) {
    console.error('Form submission could not be stored; rolling back', error);
    await rollBackSubmission(
      db,
      bucket,
      submission?.id ?? null,
      stored.map((file) => file.mediaId),
    );
    return { ok: false, status: 500, error: STORAGE_FAILED };
  }

  return { ok: true, submission };
}

// Best effort: each step runs even if an earlier one fails, so one broken delete can't leave the
// rest behind. Deleting the submission also removes its stage history (ON DELETE CASCADE).
async function rollBackSubmission(
  db: Database,
  bucket: R2Bucket,
  submissionId: string | null,
  mediaIds: string[],
): Promise<void> {
  const steps: Promise<unknown>[] = mediaIds.map((id) => deleteMediaFile(db, bucket, id));
  if (submissionId) steps.push(deleteFormSubmission(db, submissionId));
  const results = await Promise.allSettled(steps);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Form submission rollback step failed', result.reason);
  }
}
