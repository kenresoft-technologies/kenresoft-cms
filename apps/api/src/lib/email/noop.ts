import type { EmailMessage, EmailSender } from './types';

// The default sender when no EMAIL_PROVIDER is configured — logs instead of failing, so
// pnpm dev and a fresh deployment both keep working with zero email setup. A deployment that
// actually needs password-reset emails to arrive sets EMAIL_PROVIDER explicitly (see
// docs/ARCHITECTURE.md's recovery section); this is not a silent production fallback so much
// as "email is opt-in infrastructure, not a hard dependency of this CMS."
export const noopEmailSender: EmailSender = {
  async send(message: EmailMessage) {
    console.log('[email:noop] EMAIL_PROVIDER is not configured — would have sent:', {
      to: message.to,
      subject: message.subject,
    });
  },
};
