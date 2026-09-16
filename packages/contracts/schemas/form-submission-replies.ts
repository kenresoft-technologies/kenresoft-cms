import { z } from 'zod';

export const formSubmissionReplySchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  authorUserId: z.string().nullable(),
  authorName: z.string().nullable(),
  to: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  createdAt: z.string(),
});

export const createFormSubmissionReplySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1).max(20000),
});

export type FormSubmissionReply = z.infer<typeof formSubmissionReplySchema>;
export type CreateFormSubmissionReplyInput = z.infer<typeof createFormSubmissionReplySchema>;
