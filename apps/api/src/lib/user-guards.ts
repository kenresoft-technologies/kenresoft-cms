import type { UserRole } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { countGuardians } from '../repositories/users';

// Every route in routes/admin/users.ts already returns c.json(...) directly on failure rather
// than throwing — these guards match that style (a result, not an exception) instead of
// introducing exception-based control flow the codebase doesn't otherwise use.
export type GuardResult = { ok: true } | { ok: false; status: 400 | 403; error: string };

const OK: GuardResult = { ok: true };

// Owner is untouchable through the normal user-management routes, full stop — role changes,
// disabling, and deletion targeting an owner are always rejected here, regardless of who's
// asking (even another owner, once multi-owner exists). The only way an owner's role ever
// changes is the dedicated ownership-transfer endpoint, which is atomic by construction and
// can never produce a zero-owner state.
export function checkNotTargetingOwner(target: { role: UserRole }): GuardResult {
  if (target.role === 'owner') {
    return { ok: false, status: 403, error: 'Ownership changes must go through Transfer ownership' };
  }
  return OK;
}

// Generalizes the old "zero admins" guard to "zero guardians" (owner + admin combined) — an
// owner already satisfies every requireRole('admin') check via ROLE_RANK, so a deployment with
// one owner and zero admins isn't actually locked out. `excludingUserId` is the user the caller
// is about to demote/delete/disable, so the count reflects the state *after* that change.
export async function checkGuardianRemains(db: Database, excludingUserId: string): Promise<GuardResult> {
  const remaining = await countGuardians(db, { excluding: excludingUserId });
  if (remaining < 1) {
    return { ok: false, status: 400, error: 'This would leave the deployment with no owner or admin' };
  }
  return OK;
}
