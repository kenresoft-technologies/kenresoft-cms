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
  waitUntil(
    email.send({
      to: customer.email,
      subject: 'Verify your email',
      // config.siteUrl is optional (this plugin has no way to know a storefront's own URL on its
      // own — same reasoning as Core's settings.previewUrl) — when it's unset, fall back to a
      // plain instruction rather than a bare, unexplained token with nothing to do with it.
      text: resolvedConfig.siteUrl
        ? `Verify your email by visiting: ${resolvedConfig.siteUrl}/account/verify-email?token=${verifyToken}`
        : `Verify your email with this token: ${verifyToken}`,
    }),
  );
}
