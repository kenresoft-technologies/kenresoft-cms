// Forms are admin-configurable with arbitrary field names, so there's no guaranteed "email"/
// "name" column to join against — this derives a best-effort sender label straight from a
// submission's own data blob, matching on common field-name spellings rather than a fixed
// schema. Used by the Submitted-by column on both the per-form and unified submissions tables.
export interface SubmissionSender {
  name: string | null;
  email: string | null;
}

const EMAIL_KEYS = ['email', 'emailaddress', 'e-mail'];
const NAME_KEYS = ['name', 'fullname', 'yourname', 'firstname'];

function findByKey(data: Record<string, unknown>, candidates: string[]): string | null {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (candidates.includes(key.toLowerCase().replace(/[^a-z]/g, ''))) return value;
  }
  return null;
}

export function getSubmissionSender(data: Record<string, unknown>): SubmissionSender {
  return {
    name: findByKey(data, NAME_KEYS),
    email: findByKey(data, EMAIL_KEYS),
  };
}
