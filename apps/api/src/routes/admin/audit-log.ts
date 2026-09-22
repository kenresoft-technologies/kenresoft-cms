import { createRoute } from '@hono/zod-openapi';
import { auditLogEntryWithActorSchema, listAuditLogQuerySchema } from '@kenresoft-cms/contracts';
import type { AuditLogEntryWithActor } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { clearAuditLog, listAuditLog } from '../../repositories/audit-log';
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
    const rows = await listAuditLog(db, {
      actorUserId,
      action,
      from,
      to,
      limit,
      offset,
      hideOwner: c.get('user').role !== 'owner',
    });
    return c.json(rows.map(toAuditLogEntry), 200);
  },
);

// Owner-only, stricter than the GET's admin floor — clearing the accountability trail
// (including of other admins' own actions) is sensitive enough to reserve for the one role
// nothing else in the CMS can touch either. Irreversible: no undo, no export-first step here —
// an owner who wants a copy first should read the GET route before clearing.
auditLogRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/',
    tags: ['Audit log'],
    summary: 'Permanently clear every audit log entry (owner only)',
    middleware: requireRole('owner'),
    responses: {
      204: { description: 'The audit log was cleared.' },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const user = c.get('user');
    await clearAuditLog(db);
    // Recorded after the clear, not before — this is the one row guaranteed to survive it,
    // so the log is never left with zero evidence that a wipe happened, by whom, and when.
    await recordAudit(db, { actorUserId: user.id, action: 'audit_log.cleared' });
    return c.body(null, 204);
  },
);
