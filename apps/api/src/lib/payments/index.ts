import { noopPaymentProvider } from './noop';
import { createPaystackProvider } from './paystack';
import type { Bindings } from '../env';
import type { PaymentProvider } from './types';

export type { PaymentProvider, InitializePaymentInput, InitializePaymentResult, VerifyPaymentResult, PaymentTransactionStatus } from './types';

// Selected by whether PAYSTACK_SECRET_KEY is set, not a separate PAYMENT_PROVIDER var — there's
// only one provider today, so a selector variable would just be one more thing to configure for
// no real choice yet (unlike EMAIL_PROVIDER, which genuinely picks between several). Add a real
// selector if/when a second provider exists.
export function getPaymentProvider(env: Bindings): PaymentProvider {
  if (env.PAYSTACK_SECRET_KEY) {
    return createPaystackProvider(env);
  }
  return noopPaymentProvider;
}
