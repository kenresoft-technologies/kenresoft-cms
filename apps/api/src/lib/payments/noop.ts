import type { PaymentProvider } from './types';

// The provider when PAYSTACK_SECRET_KEY is unset — mirrors noopEmailSender's own reasoning
// exactly: payments are opt-in infrastructure, not a hard dependency of this CMS, so an
// unconfigured deployment shouldn't crash, it should just not offer payment initialization.
// Every method throws rather than silently no-opping (unlike the noop email sender, which
// logs-and-succeeds) — a route calling this without first checking `.configured` is a real bug
// worth surfacing loudly, not a request that should quietly pretend to work.
export const noopPaymentProvider: PaymentProvider = {
  configured: false,
  async initializeTransaction() {
    throw new Error('Payments are not configured for this deployment (PAYSTACK_SECRET_KEY is unset)');
  },
  async verifyTransaction() {
    throw new Error('Payments are not configured for this deployment (PAYSTACK_SECRET_KEY is unset)');
  },
  async verifyWebhookSignature() {
    return false;
  },
  getStatus() {
    return { configured: false, environment: 'unknown' };
  },
};
