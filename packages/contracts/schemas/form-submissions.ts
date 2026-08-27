import { z } from 'zod';

export const FORM_SUBMISSION_STATUSES = ['new', 'read', 'archived'] as const;

export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

// No create-request schema — public form submissions are validated dynamically against the
// form's own field definitions (apps/api/src/lib/form-submission-validation.ts), not a fixed
// shape known at route-definition time.
export const formSubmissionSchema = z.object({
  id: z.string(),
  formId: z.string(),
  data: z.record(z.string(), z.unknown()),
  status: z.enum(FORM_SUBMISSION_STATUSES),
  createdAt: z.string(),
});

export const updateFormSubmissionStatusSchema = z.object({
  status: z.enum(FORM_SUBMISSION_STATUSES),
});

export type FormSubmission = z.infer<typeof formSubmissionSchema>;
export type UpdateFormSubmissionStatusInput = z.infer<typeof updateFormSubmissionStatusSchema>;
