import { auditLog } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

import { getSettings } from '../repositories/settings';

// The one place audit-log rows get written, so "never put a password/token/recovery code in
// metadata" (docs/ARCHITECTURE.md §10) has a single place to hold rather than being a rule
// every call site has to remember independently. `metadata` should carry only non-secret
// context — e.g. { previousRole, newRole } for a role change.
//
// Also the one place `Settings.featureFlags.auditLoggingEnabled` is checked — the table has no
// retention/pruning (it grows forever otherwise), so an owner who'd rather not pay that D1
// growth can opt out here without touching any of this function's ~20 call sites. Defaults to
// on (`!== false`, not `=== true`) so every existing deployment keeps its current behavior
// until an owner makes a deliberate choice to turn it off.
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
  const settings = await getSettings(db);
  if (settings?.featureFlags?.['auditLoggingEnabled'] === false) return;

  await db.insert(auditLog).values({ id: crypto.randomUUID(), ...entry });
}
