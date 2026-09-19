import { z } from 'zod';

// Metadata only — the binary is never stored. `mediaId` is set when the attachment came from the
// Media Library (the file itself stays there under its own access rules).
export const emailAttachmentMetaSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  source: z.enum(['upload', 'media']),
  mediaId: z.string().optional(),
});

export const formSubmissionReplySchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  authorUserId: z.string().nullable(),
  authorName: z.string().nullable(),
  to: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  attachments: z.array(emailAttachmentMetaSchema),
  createdAt: z.string(),
});

export const createFormSubmissionReplySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1).max(20000),
});

export type EmailAttachmentMeta = z.infer<typeof emailAttachmentMetaSchema>;
export type FormSubmissionReply = z.infer<typeof formSubmissionReplySchema>;
export type CreateFormSubmissionReplyInput = z.infer<typeof createFormSubmissionReplySchema>;
