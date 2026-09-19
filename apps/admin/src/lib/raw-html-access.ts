import { authClient } from '@/lib/auth-client';
import { useSettings } from '@/lib/queries/settings';
import { roleAtLeast, type UserRole } from '@/lib/types';

// Who may use Raw HTML blocks, mirroring the server's rules (apps/api/src/lib/raw-html-guard.ts —
// the server is what actually enforces them; this only decides what to show).
export function useRawHtmlAccess() {
  const { data: session } = authClient.useSession();
  const { data: settings } = useSettings();
  return {
    enabled: settings?.featureFlags?.['rawHtmlBlocks'] === true,
    isAdmin: roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin'),
  };
}
