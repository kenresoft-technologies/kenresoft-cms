import { z } from 'zod';

export const dashboardStatsSchema = z.object({
  contentTypeCount: z.number().int(),
  entryCounts: z.object({
    draft: z.number().int(),
    published: z.number().int(),
  }),
  mediaCount: z.number().int(),
  mediaStorageBytes: z.number(),
  recentEntries: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      status: z.string(),
      contentTypeId: z.string(),
      contentTypeName: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
