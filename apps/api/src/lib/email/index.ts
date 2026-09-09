import { createCloudflareEmailSender } from './cloudflare';
import { noopEmailSender } from './noop';
import { createResendEmailSender } from './resend';
import type { Bindings } from '../env';
import type { EmailSender } from './types';

export type { EmailMessage, EmailSender } from './types';

// Selected per-deployment via EMAIL_PROVIDER, not hardcoded — a fork can run entirely on
// Cloudflare's own product, entirely on Resend, or (the default, unset) with no email sending
// configured at all, which is intentionally not an error: password-reset requests still
// respond normally (docs/ARCHITECTURE.md's recovery section), they just don't deliver
// anything, and the noop sender logs that fact for whoever's watching the Worker's logs.
export function getEmailSender(env: Bindings): EmailSender {
  switch (env.EMAIL_PROVIDER) {
    case 'cloudflare':
      return createCloudflareEmailSender(env);
    case 'resend':
      return createResendEmailSender(env);
    default:
      return noopEmailSender;
  }
}
