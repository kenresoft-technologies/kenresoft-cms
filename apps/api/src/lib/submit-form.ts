import type { Database, FormField, FormSubmission } from '@kenresoft-cms/database';

import { validateSubmission } from './form-submission-validation';
import { uploadMedia } from './media-service';
import { createMediaAttachment } from '../repositories/media-attachments';
import { createFormSubmission, updateFormSubmissionData } from '../repositories/form-submissions';

// Shared by the public submission route (routes/public/forms.ts) and the admin "Preview & Test"
// route (routes/admin/forms.ts's test-submissions) — both need the exact same validate → create
// → upload-and-attach-files pipeline, just with a different `isTest` flag and different
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
  | { ok: false; error: string; issues?: { path: PropertyKey[]; message: string }[] };

export async function submitForm(
  db: Database,
  bucket: R2Bucket,
  formId: string,
  fields: FormField[],
  parsed: ParsedSubmissionBody,
  options: { isTest: boolean },
): Promise<SubmitFormResult> {
  const validated = await validateSubmission(fields, parsed.body, parsed.uploadedFiles);
  if (validated.issues) {
    return { ok: false, error: 'Validation failed', issues: validated.issues };
  }

  const data: Record<string, unknown> = { ...validated.data };
  const submission = await createFormSubmission(db, { formId, data, isTest: options.isTest });

  // A file's real Media reference isn't known until after upload, and media_attachments needs
  // the submission's own id — so file fields are attached in a second pass, right after
  // creation, rather than blocking submission creation on however many uploads a form has.
  // Every submitted file becomes a real, private Media asset (Phase 5's "single canonical Media
  // table" decision) rather than a bare R2 object the CMS otherwise knows nothing about — never
  // shown in the admin Media Library's default grid (visibility: 'private'), reachable only
  // through the submission's own detail view.
  const fileEntries = Object.entries(validated.files ?? {});
  if (fileEntries.length > 0) {
    const updatedData: Record<string, unknown> = { ...data };
    for (const [fieldName, attachment] of fileEntries) {
      const uploadResult = await uploadMedia(db, bucket, {
        bytes: attachment.bytes,
        filename: attachment.filename,
        altText: null,
        visibility: 'private',
      });
      if (!uploadResult.ok) {
        // Already sniffed successfully by validateSubmission above — this should never actually
        // fail, but if it somehow does, skip this one field rather than lose the rest of an
        // already-created, otherwise-valid submission.
        continue;
      }
      await createMediaAttachment(db, {
        mediaId: uploadResult.media.id,
        ownerType: 'form_submission',
        ownerId: submission.id,
        fieldName,
      });
      updatedData[fieldName] = {
        mediaId: uploadResult.media.id,
        filename: attachment.filename,
        size: attachment.bytes.byteLength,
        contentType: attachment.contentType,
      };
    }
    submission.data = updatedData;
    await updateFormSubmissionData(db, submission.id, updatedData);
  }

  return { ok: true, submission };
}
