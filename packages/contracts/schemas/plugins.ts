import { z } from 'zod';

export const pluginSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.string(),
  enabled: z.boolean(),
});

export const updatePluginEnablementSchema = z.object({
  enabled: z.boolean(),
});

export type PluginSummary = z.infer<typeof pluginSummarySchema>;
export type UpdatePluginEnablementInput = z.infer<typeof updatePluginEnablementSchema>;
