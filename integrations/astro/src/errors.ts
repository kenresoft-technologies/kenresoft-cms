export interface FormSubmissionIssue {
  path: (string | number)[];
  message: string;
}

// Thrown for any non-2xx, non-404 response from entries.list/entries.get (a 404 there is not
// an error from this client's perspective — see request() in index.ts — since "no content type
// with that slug" and "no published entry with that slug" are both normal, expected outcomes for
// public content), for ANY non-2xx response from forms.submit and from every `auth.*`/`commerce.*`
// call, where 400/401/403/404/429 are all meaningfully different outcomes a caller needs to
// handle, not something to paper over as null.
//
// `issues` is populated only for a 400 from forms.submit (form-specific field validation).
// `code` is populated when the API supplied a machine-readable code — better-auth's own error
// bodies are `{ code, message }` (e.g. "EMAIL_NOT_VERIFIED", "INVALID_EMAIL_OR_PASSWORD"), so
// `auth.*` callers can branch on `err.code` instead of matching message text.
export class KenresoftApiError extends Error {
  status: number;
  issues: FormSubmissionIssue[] | undefined;
  code: string | undefined;

  constructor(status: number, message: string, issues?: FormSubmissionIssue[], code?: string) {
    super(message);
    this.name = 'KenresoftApiError';
    this.status = status;
    this.issues = issues;
    this.code = code;
  }
}
