import { auditLog } from '@kenresoft/database';
import type { Database } from '@kenresoft/database';

// The one place audit-log rows get written, so "never put a password/token/recovery code in
// metadata" (docs/ARCHITECTURE.md §10) has a single place to hold rather than being a rule
// every call site has to remember independently. `metadata` should carry only non-secret
// context — e.g. { previousRole, newRole } for a role change.
export async function recordAudit(
  db: Database,
  entry: {
    actorUserId?: string;
    actorLabel?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLog).values({ id: crypto.randomUUID(), ...entry });
}
