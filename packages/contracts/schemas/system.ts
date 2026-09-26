import { z } from 'zod';

// GET /api/v1/admin/system/version (admin only): the CMS release this deployment is running, and
// the newest published release when the update check is on (docs/RELEASING.md). Kept off the
// public API on purpose: an exact version on an unauthenticated endpoint helps an attacker match
// a deployment against known vulnerabilities.
export const latestReleaseSchema = z.object({
  version: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});

export const systemVersionSchema = z.object({
  version: z.string(),
  latest: latestReleaseSchema.nullable(),
  updateAvailable: z.boolean(),
  // 'disabled': UPDATE_CHECK_REPO is "off"; 'unavailable': the check is on but GitHub couldn't be
  // reached or had no release; 'ok': `latest` is set.
  updateCheck: z.enum(['ok', 'disabled', 'unavailable']),
});

export type LatestRelease = z.infer<typeof latestReleaseSchema>;
export type SystemVersion = z.infer<typeof systemVersionSchema>;
