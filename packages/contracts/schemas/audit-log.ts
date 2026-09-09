import { z } from 'zod';

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorLabel: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

// Admin-only, same reasoning as EntryWithContentType in schemas/entries.ts — actorName/
// actorEmail identify an internal user and have no business being on any public-facing shape.
export const auditLogEntryWithActorSchema = auditLogEntrySchema.extend({
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
});

export type AuditLogEntryWithActor = z.infer<typeof auditLogEntryWithActorSchema>;

export const listAuditLogQuerySchema = z.object({
  actorUserId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;
