// Renders one non-attachment field's value on the Submission Detail page. Read-only display,
// deliberately never styled like an editable input — submitted data is a record, not a form.
//
// whitespace-pre-wrap: a textarea field's line breaks/paragraph spacing (exactly as the
// visitor typed it — sanitizeText() in form-submission-validation.ts only strips angle
// brackets, never touches newlines) would otherwise be collapsed to a single line by HTML's
// own default whitespace handling.
export function SubmissionValue({ value }: { value: unknown }) {
  return <p className="text-sm break-words whitespace-pre-wrap">{String(value)}</p>;
}
