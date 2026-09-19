import { z } from 'zod';

export const settingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  corsOrigin: z.string().nullable(),
  featureFlags: z.record(z.string(), z.boolean()).nullable(),
  previewUrl: z.string().nullable(),
  pagePreviewUrl: z.string().nullable(),
  emailSenderName: z.string().nullable(),
  emailSenderEmail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const upsertSettingsSchema = z.object({
  name: z.string().min(1).max(200),
  corsOrigin: z.union([z.null(), z.string().max(500)]).optional(),
  featureFlags: z.union([z.null(), z.record(z.string(), z.boolean())]).optional(),
  previewUrl: z.union([z.null(), z.string().max(500)]).optional(),
  pagePreviewUrl: z.union([z.null(), z.string().max(500)]).optional(),
  // Omitted = leave unchanged; null = clear back to EMAIL_FROM.
  // Name is restricted so it can't inject header syntax into the From line.
  emailSenderName: z
    .union([z.null(), z.string().max(100).regex(/^[^<>"\r\n,;]*$/, 'Name contains invalid characters')])
    .optional(),
  emailSenderEmail: z.union([z.null(), z.string().max(254).email()]).optional(),
});

export const sendAdminEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().trim().min(1).max(300),
  bodyHtml: z.string().min(1).max(100_000),
  // Defaults to the sending staff member's own email.
  replyTo: z.string().email().optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type UpsertSettingsInput = z.infer<typeof upsertSettingsSchema>;
