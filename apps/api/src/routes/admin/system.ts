import { createRoute } from '@hono/zod-openapi';
import { systemVersionSchema } from '@kenresoft-cms/contracts';

import { createOpenApiApp } from '../../lib/openapi';
import { fetchLatestRelease, updateCheckRepo } from '../../lib/update-check';
import { CMS_VERSION, compareVersions } from '../../lib/version';
import { requireRole } from '../../middleware/require-role';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const adminSystemRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

// Admin-only: only an Admin or Owner can act on "an update is available", and the exact version
// stays off the public API (see packages/contracts/schemas/system.ts).
adminSystemRoute.openapi(
  createRoute({
    method: 'get',
    path: '/version',
    tags: ['System'],
    summary: 'The CMS version this deployment runs, and the latest release (admin only)',
    middleware: requireRole('admin'),
    responses: {
      200: {
        description: 'The running version, and the newest published release when the update check is on.',
        content: { 'application/json': { schema: systemVersionSchema } },
      },
    },
  }),
  async (c) => {
    const repo = updateCheckRepo(c.env.UPDATE_CHECK_REPO);
    const latest = repo ? await fetchLatestRelease(repo) : null;
    return c.json(
      {
        version: CMS_VERSION,
        latest,
        updateAvailable: latest !== null && (compareVersions(latest.version, CMS_VERSION) ?? 0) > 0,
        updateCheck: repo === null ? ('disabled' as const) : latest ? ('ok' as const) : ('unavailable' as const),
      },
      200,
    );
  },
);
