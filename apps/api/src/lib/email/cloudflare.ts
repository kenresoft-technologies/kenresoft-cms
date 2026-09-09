import type { Bindings } from '../env';
import type { EmailMessage, EmailSender } from './types';

// Cloudflare Email Service (the `send_email` binding) sends to arbitrary destinations directly
// from a Worker — no MIME construction needed, `SendEmail.send()` accepts the message fields
// directly (@cloudflare/workers-types' EmailMessageBuilder). Only the `from` domain needs
// onboarding, via `wrangler email sending enable` — see docs/ARCHITECTURE.md's recovery
// section for the full setup (the wrangler.toml [[send_email]] binding plus that CLI step).
export function createCloudflareEmailSender(env: Bindings): EmailSender {
  return {
    async send(message: EmailMessage) {
      if (!env.EMAIL) {
        throw new Error('EMAIL_PROVIDER=cloudflare but no EMAIL binding is configured in wrangler.toml');
      }
      if (!env.EMAIL_FROM) {
        throw new Error('EMAIL_PROVIDER=cloudflare but EMAIL_FROM is not set');
      }
      await env.EMAIL.send({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html !== undefined ? { html: message.html } : {}),
      });
    },
  };
}
