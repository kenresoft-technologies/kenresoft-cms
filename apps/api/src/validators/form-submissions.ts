import { z } from 'zod';
import { FORM_SUBMISSION_STATUSES } from '@kenresoft/database';

export const updateFormSubmissionStatusSchema = z.object({
  status: z.enum(FORM_SUBMISSION_STATUSES),
});
