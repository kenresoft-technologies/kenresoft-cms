import { getSettings } from '../../repositories/settings';
import type { Database } from '@kenresoft-cms/database';

// The From value for admin-initiated mail, from Settings' optional sender identity. Returns
// undefined (→ the provider's own EMAIL_FROM) unless a sender email is configured, so system
// mail and any deployment that never sets this behave exactly as before. The name is validated
// at write time to exclude header-significant characters, so plain interpolation is safe.
export async function getAdminFrom(db: Database): Promise<string | undefined> {
  const row = await getSettings(db);
  if (!row?.emailSenderEmail) {
    return undefined;
  }
  return row.emailSenderName ? `${row.emailSenderName} <${row.emailSenderEmail}>` : row.emailSenderEmail;
}

// Default Reply-To for admin-initiated mail: the configured sender address (so replies reach the
// mailbox the deployment presents itself as), else the sending staff member's own address. A
// per-message override always wins over both.
export async function getDefaultReplyTo(db: Database, staffEmail: string): Promise<string> {
  const row = await getSettings(db);
  return row?.emailSenderEmail ?? staffEmail;
}
