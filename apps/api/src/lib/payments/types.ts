// A payment gateway's amount/currency, never a caller-supplied one — every field on this shape
// is populated exclusively from the provider's own verified response (verifyTransaction) or
// signed webhook payload, and callers must check it against an order's own totalAmount/currency
// before ever trusting it (routes/payments.ts) — this type doesn't enforce that on its own.
//
// Paystack's real transaction-status vocabulary is wider than a naive success/failure binary —
// 'pending'/'ongoing'/'processing'/'queued' are all genuinely non-terminal (the transaction is
// still in flight at Paystack, not failed), and 'reversed' means a previously successful charge
// was reversed after the fact. Collapsing any of these into 'failed' would incorrectly resolve a
// payment attempt that hasn't actually finished yet — callers must treat only 'success' and
// 'failed'/'abandoned' as terminal; everything else must leave the payment attempt 'pending' for
// a later check (routes/payments.ts's own status-branching has the authoritative list).
export type PaymentTransactionStatus =
  | 'success'
  | 'failed'
  | 'abandoned'
  | 'pending'
  | 'ongoing'
  | 'processing'
  | 'queued'
  | 'reversed'
  | 'other';

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

// A deliberately non-sensitive status snapshot for a developer-facing admin UI (the Commerce
// Settings page's Paystack section) — never the key itself, never anything derived from it beyond
// which of Paystack's two documented key prefixes (`sk_test_`/`sk_live_`) it starts with.
// 'unknown' covers a configured key that, for whatever reason, doesn't match either documented
// prefix — surfaced honestly rather than guessed at.
export interface PaymentProviderStatus {
  configured: boolean;
  environment: 'test' | 'live' | 'unknown';
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
  // Non-sensitive, synchronous, never touches the network — a plain local read of whether a key
  // is set and which documented prefix it has. See PaymentProviderStatus above for exactly what
  // this may and may not expose.
  getStatus(): PaymentProviderStatus;
}
