import { createCloudflareEmailSender } from './cloudflare';
import { noopEmailSender } from './noop';
import { createResendEmailSender } from './resend';
import { testEmailSender } from './test';
import type { Bindings } from '../env';
import type { EmailSender } from './types';

export type { EmailMessage, EmailSender } from './types';
export { getTestEmails, clearTestEmails } from './test';

// The full required-config check per provider, not just whether EMAIL_PROVIDER has a
// recognized value — setting EMAIL_PROVIDER=resend with no RESEND_API_KEY/EMAIL_FROM (or
// =cloudflare with no EMAIL binding/EMAIL_FROM) still throws at actual send time
// (resend.ts/cloudflare.ts), so "configured" here means sending would actually work, not just
// that a provider was named. Shared by GET /api/v1/system/status and anything that needs to
// know before attempting a send whether it's worth trying at all (e.g. an in-CMS reply route,
// which should 400 with a clear message rather than surface a raw provider error).
export function isEmailProviderConfigured(env: Bindings): boolean {
  return (
    (env.EMAIL_PROVIDER === 'resend' && Boolean(env.RESEND_API_KEY) && Boolean(env.EMAIL_FROM)) ||
    (env.EMAIL_PROVIDER === 'cloudflare' && Boolean(env.EMAIL) && Boolean(env.EMAIL_FROM)) ||
    // Test-pool only (apps/api/wrangler.test.toml) — testEmailSender genuinely "delivers" (into
    // getTestEmails()' capture store), so this is accurate, not a special case carved out to
    // dodge the check: a real deployment never sets EMAIL_PROVIDER=test.
    env.EMAIL_PROVIDER === 'test'
  );
}

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
    // Test-pool only (apps/api/wrangler.test.toml) — never a real deployment value. Lets
    // tests inspect what would have been sent via getTestEmails() instead of bypassing the
    // email layer entirely.
    case 'test':
      return testEmailSender;
    default:
      return noopEmailSender;
  }
}
