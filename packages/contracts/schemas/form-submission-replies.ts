import { z } from 'zod';

// `mediaId` points at the stored file: uploads are kept as private Media, and Media Library
// attachments reference their existing Media. Replies recorded before uploads were stored have
// no mediaId for an upload (the file was only ever emailed).
export const emailAttachmentMetaSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  source: z.enum(['upload', 'media']),
  mediaId: z.string().optional(),
});

// One message on a submission's thread. 'outbound' is a staff reply sent by email to `to`;
// 'inbound' is a message the owning account posted from the site (no `to`/`subject`).
export const formSubmissionReplySchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  direction: z.enum(['outbound', 'inbound']),
  authorUserId: z.string().nullable(),
  authorName: z.string().nullable(),
  to: z.string().nullable(),
  subject: z.string().nullable(),
  bodyHtml: z.string(),
  attachments: z.array(emailAttachmentMetaSchema),
  createdAt: z.string(),
});

export const createFormSubmissionReplySchema = z.object({
  to: z.string().email(),
  subject: z
    .string()
    .min(1)
    .max(300)
    .refine((value) => !/[\r\n]/.test(value), 'Subject cannot contain line breaks'),
  bodyHtml: z.string().min(1).max(20000),
  replyTo: z.string().email().optional(),
});

export type EmailAttachmentMeta = z.infer<typeof emailAttachmentMetaSchema>;
export type FormSubmissionReply = z.infer<typeof formSubmissionReplySchema>;
export type CreateFormSubmissionReplyInput = z.infer<typeof createFormSubmissionReplySchema>;
