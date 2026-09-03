import { z } from 'zod';

export const settingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  contactEmail: z.string().nullable(),
  socialLinks: z.record(z.string(), z.string()).nullable(),
  corsOrigin: z.string().nullable(),
  featureFlags: z.record(z.string(), z.boolean()).nullable(),
  previewUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const upsertSettingsSchema = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.union([z.null(), z.string().email().max(320)]).optional(),
  socialLinks: z.union([z.null(), z.record(z.string(), z.string().max(500))]).optional(),
  corsOrigin: z.union([z.null(), z.string().max(500)]).optional(),
  featureFlags: z.union([z.null(), z.record(z.string(), z.boolean())]).optional(),
  previewUrl: z.union([z.null(), z.string().max(500)]).optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type UpsertSettingsInput = z.infer<typeof upsertSettingsSchema>;
