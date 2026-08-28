import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { user } from './auth';

// A durable record of security-sensitive actions (role changes, disabling, ownership transfer,
// recovery usage — docs/ARCHITECTURE.md §10) for after-the-fact review, not a general activity
// feed. `actorUserId` is nullable and set-null-on-delete, same pattern as entries.createdBy —
// history survives a deleted actor. `actorLabel` covers actors with no user row at all (an
// emergency CLI/HTTP recovery tool, added alongside the recovery mechanisms). `metadata` is
// free-form JSON context for the action (e.g. { previousRole, newRole }) — callers must never
// put a password, token, or recovery code in it; apps/api/src/lib/audit.ts is the one place
// entries get written, specifically so that rule has one place to hold rather than many.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('audit_log_action_idx').on(table.action),
    index('audit_log_created_at_idx').on(table.createdAt),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
