import type { PluginConfigService, PluginEmailService } from '@kenresoft-cms/plugin-sdk';

import type { CommerceConfig } from '../config-schema';
import { createCustomerToken } from '../repository/customer-tokens';
import type { Database } from '@kenresoft-cms/database';

// Shared by the customer-facing register/resend routes (customer-auth.ts) and the CMS-staff
// resend action (admin-customers.ts) — issuing a new token here always supersedes any prior
// unconsumed one (createCustomerToken's own delete-then-insert), so this is never "one of
// several simultaneously valid tokens," regardless of who triggered it or how many times.
export async function sendVerificationEmail(
  db: Database,
  waitUntil: (promise: Promise<unknown>) => void,
  email: Pick<PluginEmailService, 'send'>,
  config: Pick<PluginConfigService, 'get'>,
  customer: { id: string; email: string },
): Promise<void> {
  const verifyToken = await createCustomerToken(db, customer.id, 'email_verification');
  const resolvedConfig = (await config.get()) as CommerceConfig;
  // config.siteUrl is optional (this plugin has no way to know a storefront's own URL on its
  // own — same reasoning as Core's settings.previewUrl) — when it's unset, there's no page this
  // plugin can build a working link to, so the email says so explicitly (instead of handing over
  // an unexplained bare token) and names exactly where an operator sets it.
  const verifyUrl = resolvedConfig.siteUrl ? `${resolvedConfig.siteUrl}/account/verify-email?token=${verifyToken}` : null;
  waitUntil(
    email.send({
      to: customer.email,
      subject: 'Verify your email',
      text: verifyUrl
        ? `Verify your email by visiting: ${verifyUrl}\n\nThis link expires soon — if it doesn't work, request a new verification email.`
        : `Your email verification code is: ${verifyToken}\n\n(This store hasn't configured its site URL yet, so we can't send a clickable link — enter this code on the store's verify-email page, or ask the store to set Site URL under Settings → Commerce.)`,
      ...(verifyUrl
        ? {
            html: `<p>Verify your email by <a href="${verifyUrl}">clicking here</a>.</p><p>This link expires soon — if it doesn't work, request a new verification email.</p>`,
          }
        : {}),
    }),
  );
}
