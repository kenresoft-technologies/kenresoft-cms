import { authClient } from '@/lib/auth-client';
import { useSettings } from '@/lib/queries/settings';
import { roleAtLeast, type UserRole } from '@/lib/types';

// Content managers get a clean, non-technical CMS by default — Developer Mode is an opt-in,
// deployment-wide layer an admin turns on from Settings → API → Developer experience
// (apps/admin/src/pages/settings/ApiSection.tsx), stored in the existing Settings.featureFlags
// JSON column, not a new schema/migration.
//
// Viewer is deliberately excluded even when the flag is on: it's the read-only,
// non-technical-stakeholder role in this CMS's role model, and this threshold is the one place
// that decides who sees developer tooling — raising it later is a one-line change here rather
// than a change to every panel's trigger. Everyone at or above Author (Author, Editor, Admin,
// Owner) qualifies — a rank check rather than a hardcoded list so a future role slotted above
// Author qualifies automatically.
const DEVELOPER_MODE_MINIMUM_ROLE: UserRole = 'author';
export const DEVELOPER_MODE_ROLES: UserRole[] = ['owner', 'admin', 'editor', 'author'];

export function useDeveloperMode(): boolean {
  const { data: settings } = useSettings();
  const { data: session } = authClient.useSession();

  const enabled = settings?.featureFlags?.developerMode ?? false;
  const role = session?.user.role as UserRole | undefined;

  return enabled && role !== undefined && roleAtLeast(role, DEVELOPER_MODE_MINIMUM_ROLE);
}
