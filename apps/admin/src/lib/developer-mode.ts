import { authClient } from '@/lib/auth-client';
import { useSettings } from '@/lib/queries/settings';
import { roleAtLeast, type UserRole } from '@/lib/types';

// Content managers get a clean, non-technical CMS by default — Developer Mode is an opt-in,
// deployment-wide layer an admin turns on from Settings → API → Developer experience
// (apps/admin/src/pages/settings/ApiSection.tsx), stored in the existing Settings.featureFlags
// JSON column, not a new schema/migration.
//
// Who actually sees the panel once that flag is on is a separate question from the flag
// itself, split two ways:
//   - Owner/admin always qualify — they're the ones who can turn the deployment-wide flag on
//     in the first place, so gating them too would add friction without adding safety.
//   - Editor/author need an explicit per-user grant (`user.developerToolsAccess`, toggled from
//     the Users page — apps/api/src/routes/admin/users.ts's PATCH .../developer-tools-access)
//     rather than qualifying automatically from role. This replaced an earlier "everyone at or
//     above Author automatically gets it" rule: with only a deployment-wide toggle, every
//     author on a team saw developer tooling as soon as one admin turned it on for anyone,
//     even the ones who never touch the public API — the opposite of "technical people get
//     technical tooling, ordinary content managers don't."
// Viewer is excluded unconditionally regardless of this column — it's the read-only,
// non-technical-stakeholder role in this CMS's role model.
const DEVELOPER_MODE_ALWAYS_ROLE: UserRole = 'admin';

export function useDeveloperMode(): boolean {
  const { data: settings } = useSettings();
  const { data: session } = authClient.useSession();

  const enabled = settings?.featureFlags?.developerMode ?? false;
  const role = session?.user.role as UserRole | undefined;
  if (!enabled || role === undefined || role === 'viewer') return false;

  return roleAtLeast(role, DEVELOPER_MODE_ALWAYS_ROLE) || (session?.user.developerToolsAccess ?? false);
}
