import { Paperclip } from 'lucide-react';

import { formatBytes } from '@/lib/format';
import { submissionAttachmentUrl } from '@/lib/queries/form-submissions';

interface SubmissionAttachment {
  key: string;
  filename: string;
  size: number;
  contentType: string;
}

function isAttachment(value: unknown): value is SubmissionAttachment {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { filename?: unknown }).filename === 'string' &&
    typeof (value as { size?: unknown }).size === 'number' &&
    typeof (value as { contentType?: unknown }).contentType === 'string'
  );
}

// Renders one field's value inside a submission's detail dialog — shared by
// AllSubmissionsPage/FormSubmissionsPage's near-identical ViewSubmissionDialogs, which
// previously both just did `{String(value)}`, showing "[object Object]" for a `file`-type
// field's attachment shape (routes/public/forms.ts).
export function SubmissionValue({
  formId,
  submissionId,
  fieldName,
  value,
}: {
  formId: string;
  submissionId: string;
  fieldName: string;
  value: unknown;
}) {
  if (isAttachment(value)) {
    return (
      <a
        href={submissionAttachmentUrl(formId, submissionId, fieldName)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <Paperclip className="size-3.5 shrink-0" />
        {value.filename}
        <span className="text-xs text-muted-foreground">({formatBytes(value.size)})</span>
      </a>
    );
  }

  return <p className="text-sm break-words">{String(value)}</p>;
}
