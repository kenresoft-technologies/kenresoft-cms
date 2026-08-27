export const FORM_SUBMISSION_STATUSES = ['new', 'read', 'archived'] as const;

export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];
