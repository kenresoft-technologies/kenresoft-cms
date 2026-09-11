import type { EmailMessage, EmailSender } from './types';

// Test-only capture point (selected via EMAIL_PROVIDER=test in apps/api/wrangler.test.toml) —
// nothing else in this codebase could previously inspect a sent email's actual content
// (existing tests bypass the email layer entirely by reading tokens out of a DB table, which
// isn't available for better-auth's own stateless JWT verification tokens). Module-scoped
// state, not a class instance, since getEmailSender(env) is called fresh per request/test and
// has no other shared place to accumulate into — relies on Vitest-pool-workers running
// multiple SELF.fetch calls within one test file against the same worker isolate, the same
// property beforeEach's direct env.DB.exec(...) calls already depend on.
const messages: EmailMessage[] = [];

export const testEmailSender: EmailSender = {
  async send(message: EmailMessage): Promise<void> {
    messages.push(message);
  },
};

// Returns a copy — callers must never be able to mutate captured state by mutating what this
// returns.
export function getTestEmails(): readonly EmailMessage[] {
  return [...messages];
}

export function clearTestEmails(): void {
  messages.length = 0;
}
