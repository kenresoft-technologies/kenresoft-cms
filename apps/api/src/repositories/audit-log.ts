import { and, auditLog, desc, eq, gte, lte, user } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

export interface AuditLogEntryWithActor {
  id: string;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
}

export interface ListAuditLogFilters {
  actorUserId?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// Left-joined with user (not inner) — actorUserId is nullable for system/pre-account actions
// (owner-recovery, password-reset-by-token), matching how listEntriesWithContentType already
// left-joins its own nullable createdBy for the same reason.
export function listAuditLog(db: Database, filters: ListAuditLogFilters = {}): Promise<AuditLogEntryWithActor[]> {
  const conditions = [
    filters.actorUserId ? eq(auditLog.actorUserId, filters.actorUserId) : undefined,
    filters.action ? eq(auditLog.action, filters.action) : undefined,
    filters.from ? gte(auditLog.createdAt, filters.from) : undefined,
    filters.to ? lte(auditLog.createdAt, filters.to) : undefined,
  ].filter((condition) => condition !== undefined);

  return db
    .select({
      id: auditLog.id,
      actorUserId: auditLog.actorUserId,
      actorLabel: auditLog.actorLabel,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorName: user.name,
      actorEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.actorUserId, user.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);
}
