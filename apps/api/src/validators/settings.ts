import { z } from 'zod';

export const upsertSettingsSchema = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.union([z.null(), z.string().email().max(320)]).optional(),
  socialLinks: z.union([z.null(), z.record(z.string(), z.string().max(500))]).optional(),
  corsOrigin: z.union([z.null(), z.string().max(500)]).optional(),
  featureFlags: z.union([z.null(), z.record(z.string(), z.boolean())]).optional(),
});
