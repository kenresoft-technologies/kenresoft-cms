import { createRoute, z } from '@hono/zod-openapi';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { deleteIntegrationSecret, resolvePixabayKey, setIntegrationSecret } from '../../lib/secret-store';
import { requireRole } from '../../middleware/require-role';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

// Admin-and-above only, like every other route that handles a credential. Write-only by design:
// no response ever contains a key, only whether one is configured and where it came from
// ("env" = a Worker secret, which wins and can't be changed here; "admin" = entered in the CMS).
export const integrationsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const statusSchema = z.object({
  pixabay: z.object({ configured: z.boolean(), source: z.enum(['env', 'admin']).nullable() }),
});
const errorSchema = z.object({ error: z.string() });

async function status(c: { env: Bindings }, db: ReturnType<typeof getDb>) {
  const { key, source } = await resolvePixabayKey(db, c.env);
  return { pixabay: { configured: key !== null, source } };
}

integrationsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Integrations'],
    summary: 'Which third-party integrations have a key configured (never the key itself)',
    middleware: requireRole('admin'),
    responses: { 200: { description: 'Status.', content: { 'application/json': { schema: statusSchema } } } },
  }),
  async (c) => c.json(await status(c, getDb(c)), 200),
);

integrationsRoute.openapi(
  createRoute({
    method: 'put',
    path: '/pixabay',
    tags: ['Integrations'],
    summary: 'Save the Pixabay API key (encrypted at rest; write-only)',
    middleware: requireRole('admin'),
    request: {
      body: {
        content: { 'application/json': { schema: z.object({ apiKey: z.string().trim().min(8).max(200) }) } },
      },
    },
    responses: {
      200: { description: 'Status.', content: { 'application/json': { schema: statusSchema } } },
      409: { description: 'Managed by a Worker secret.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    if (c.env.PIXABAY_API_KEY) {
      return c.json({ error: 'The Pixabay key is set as a Worker secret (PIXABAY_API_KEY) and takes precedence' }, 409);
    }
    const db = getDb(c);
    await setIntegrationSecret(db, c.env, 'pixabay', c.req.valid('json').apiKey);
    // Audit metadata carries no part of the key.
    await recordAudit(db, { actorUserId: c.get('user').id, action: 'integration.key_set', targetType: 'integration', targetId: 'pixabay' });
    return c.json(await status(c, db), 200);
  },
);

integrationsRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/pixabay',
    tags: ['Integrations'],
    summary: 'Remove the Pixabay API key entered in the CMS',
    middleware: requireRole('admin'),
    responses: { 200: { description: 'Status.', content: { 'application/json': { schema: statusSchema } } } },
  }),
  async (c) => {
    const db = getDb(c);
    await deleteIntegrationSecret(db, 'pixabay');
    await recordAudit(db, { actorUserId: c.get('user').id, action: 'integration.key_removed', targetType: 'integration', targetId: 'pixabay' });
    return c.json(await status(c, db), 200);
  },
);
