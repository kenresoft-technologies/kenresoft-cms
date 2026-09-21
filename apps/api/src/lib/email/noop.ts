import type { EmailMessage, EmailSender } from './types';

// Only the links in a message — verification and password-reset URLs — are logged, never the
// whole body: other system mail carries values (e.g. an Add User onboarding email's temporary
// password) that don't belong in a log.
export function extractLinks(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])];
}

// The default sender when no EMAIL_PROVIDER is configured — logs instead of failing, so
// pnpm dev and a fresh deployment both keep working with zero email setup. A deployment that
// actually needs password-reset emails to arrive sets EMAIL_PROVIDER explicitly (see
// docs/ARCHITECTURE.md's recovery section); this is not a silent production fallback so much
// as "email is opt-in infrastructure, not a hard dependency of this CMS."
//
// The links are logged because, with no email provider, this is the only way the person who just
// deployed the Worker can get the first owner's email-verification link (every account must
// verify its email before signing in) or a password-reset link. Anyone who can read this log
// (`wrangler tail`, `wrangler dev` output, the account's Workers logs) already administers the
// deployment; once a real provider is configured this sender is never used.
export const noopEmailSender: EmailSender = {
  async send(message: EmailMessage) {
    console.log('[email:noop] EMAIL_PROVIDER is not configured — would have sent:', {
      to: message.to,
      subject: message.subject,
      links: extractLinks(message.text),
    });
  },
};
