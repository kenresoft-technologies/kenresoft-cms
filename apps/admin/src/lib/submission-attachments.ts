// Mirrors submission-sender.ts's own "derive it straight from the data blob" approach — a
// submission's shape is entirely form-defined, so there's no fixed "attachments" field to read;
// this scans for values matching the shape routes/public/forms.ts writes for a file-type field
// (see form-submission-validation.ts). Used by the Attachments column on both the per-form and
// unified submissions tables, so a job-application-style form with a resume upload is scannable
// at a glance without opening every row's detail dialog.
export interface SubmissionAttachment {
  fieldName: string;
  filename: string;
}

function isAttachmentValue(value: unknown): value is { filename?: unknown; key?: unknown; contentType?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof (value as { key: unknown }).key === 'string' &&
    'contentType' in value &&
    typeof (value as { contentType: unknown }).contentType === 'string'
  );
}

export function getSubmissionAttachments(data: Record<string, unknown>): SubmissionAttachment[] {
  return Object.entries(data)
    .filter((entry): entry is [string, { filename?: unknown }] => isAttachmentValue(entry[1]))
    .map(([fieldName, value]) => ({
      fieldName,
      filename: typeof value.filename === 'string' ? value.filename : 'file',
    }));
}

// The full attachment shape (routes/public/forms.ts's upload record), used by
// SubmissionDetailPage to split a submission's fields from its file-type attachments before
// rendering either — attachments get their own dedicated section there.
export interface SubmissionAttachmentValue {
  key: string;
  filename: string;
  size: number;
  contentType: string;
}

export function isSubmissionAttachmentValue(value: unknown): value is SubmissionAttachmentValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { filename?: unknown }).filename === 'string' &&
    typeof (value as { size?: unknown }).size === 'number' &&
    typeof (value as { contentType?: unknown }).contentType === 'string'
  );
}
