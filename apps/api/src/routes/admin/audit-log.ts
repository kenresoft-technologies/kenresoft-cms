import { createRoute } from '@hono/zod-openapi';
import { auditLogEntryWithActorSchema, listAuditLogQuerySchema } from '@kenresoft-cms/contracts';
import type { AuditLogEntryWithActor } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { listAuditLog } from '../../repositories/audit-log';
import type { AuditLogEntryWithActor as DbAuditLogEntryWithActor } from '../../repositories/audit-log';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const auditLogRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

function toAuditLogEntry(row: DbAuditLogEntryWithActor): AuditLogEntryWithActor {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorLabel: row.actorLabel,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    actorName: row.actorName,
    actorEmail: row.actorEmail,
  };
}

// Admin-and-above only, same floor as the user-management mutations that write most of these
// rows (routes/admin/users.ts, routes/admin/security.ts) — an audit trail of role changes,
// disabling, ownership transfers, and now content/auth activity is exactly the kind of thing
// that shouldn't be visible below admin, even though it's a read rather than a write.
auditLogRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Audit log'],
    summary: 'List audit log entries, newest first (admin only)',
    middleware: requireRole('admin'),
    request: { query: listAuditLogQuerySchema },
    responses: {
      200: {
        description: 'Matching audit log entries, newest first.',
        content: { 'application/json': { schema: z.array(auditLogEntryWithActorSchema) } },
      },
    },
  }),
  async (c) => {
    const { actorUserId, action, from, to, limit, offset } = c.req.valid('query');
    const db = getDb(c);
    const rows = await listAuditLog(db, { actorUserId, action, from, to, limit, offset });
    return c.json(rows.map(toAuditLogEntry), 200);
  },
);
