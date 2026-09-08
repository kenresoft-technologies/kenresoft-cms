// A payment gateway's amount/currency, never a caller-supplied one — every field on this shape
// is populated exclusively from the provider's own verified response (verifyTransaction) or
// signed webhook payload, and callers must check it against an order's own totalAmount/currency
// before ever trusting it (routes/payments.ts) — this type doesn't enforce that on its own.
export type PaymentTransactionStatus = 'success' | 'failed' | 'abandoned' | 'other';

export interface InitializePaymentInput {
  amount: number;
  currency: string;
  email: string;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifyPaymentResult {
  status: PaymentTransactionStatus;
  reference: string;
  amount: number;
  currency: string;
  raw: unknown;
}

// The boundary Commerce's own domain code depends on instead of Paystack's request/response shape
// directly (docs/PLUGINS.md's Commerce section) — Paystack is the only implementation today
// (./paystack.ts), with a noop stand-in (./noop.ts) when unconfigured, mirroring
// apps/api/src/lib/email's EmailSender/getEmailSender precedent exactly. `configured` lets a
// route check up front and return a clear "not set up" response instead of letting an
// unconfigured provider's methods throw partway through a request.
export interface PaymentProvider {
  readonly configured: boolean;
  initializeTransaction(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verifyTransaction(reference: string): Promise<VerifyPaymentResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): Promise<boolean>;
}
