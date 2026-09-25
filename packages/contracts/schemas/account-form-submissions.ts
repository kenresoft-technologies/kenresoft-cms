import { z } from 'zod';

// The account-facing view of a submission (/api/v1/account/forms/submissions), returned only to
// the account that owns it. Deliberately narrower than the admin shape: no inbox `status`, no
// staff identities or email addresses, no isTest flag.

export const accountSubmissionFileSchema = z.object({
  mediaId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
});

export const accountSubmissionMessageSchema = z.object({
  id: z.string(),
  // 'staff' for a reply from the site's team, 'account' for a message the owner posted.
  from: z.enum(['staff', 'account']),
  bodyHtml: z.string(),
  attachments: z.array(accountSubmissionFileSchema),
  createdAt: z.string(),
});

export const accountSubmissionSummarySchema = z.object({
  id: z.string(),
  formSlug: z.string(),
  formName: z.string(),
  data: z.record(z.string(), z.unknown()),
  stage: z.string().nullable(),
  stages: z.array(z.string()).nullable(),
  createdAt: z.string(),
  // The newest of the submission itself, its stage changes and its messages.
  lastActivityAt: z.string(),
});

export const accountSubmissionDetailSchema = accountSubmissionSummarySchema.extend({
  // Files submitted with the form itself (its file-type fields), keyed by field name.
  files: z.record(z.string(), accountSubmissionFileSchema),
  stageHistory: z.array(z.object({ stage: z.string(), createdAt: z.string() })),
  messages: z.array(accountSubmissionMessageSchema),
});

export const createAccountSubmissionMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export type AccountSubmissionFile = z.infer<typeof accountSubmissionFileSchema>;
export type AccountSubmissionMessage = z.infer<typeof accountSubmissionMessageSchema>;
export type AccountSubmissionSummary = z.infer<typeof accountSubmissionSummarySchema>;
export type AccountSubmissionDetail = z.infer<typeof accountSubmissionDetailSchema>;
export type CreateAccountSubmissionMessageInput = z.infer<typeof createAccountSubmissionMessageSchema>;
