import { z } from 'zod';

import { FORM_SUBMISSION_STATUSES } from './enums';

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

// Admin-only — backs the unified "all submissions" listing across every form, the same way
// entryWithContentTypeSchema backs the unified entries listing (packages/contracts/schemas/
// entries.ts). formName/formSlug let that page show which form each row came from.
export const formSubmissionWithFormSchema = formSubmissionSchema.extend({
  formName: z.string(),
  formSlug: z.string(),
});

export type FormSubmissionWithForm = z.infer<typeof formSubmissionWithFormSchema>;
