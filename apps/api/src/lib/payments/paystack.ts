import { constantTimeEqual } from 'better-auth/crypto';

import type { Bindings } from '../env';
import type { InitializePaymentInput, InitializePaymentResult, PaymentProvider, PaymentProviderStatus, PaymentTransactionStatus, VerifyPaymentResult } from './types';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: { authorization_url: string; access_code: string; reference: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data?: { status: string; reference: string; amount: number; currency: string };
}

// 1:1 with Paystack's own documented transaction statuses (never collapsed to a coarser
// success/failed binary here — that decision belongs to the caller, since 'pending'/'ongoing'/
// 'processing'/'queued' are non-terminal and must not be treated as failures).
const KNOWN_PAYSTACK_STATUSES: readonly PaymentTransactionStatus[] = [
  'success',
  'failed',
  'abandoned',
  'pending',
  'ongoing',
  'processing',
  'queued',
  'reversed',
];

function toTransactionStatus(paystackStatus: string): PaymentTransactionStatus {
  const match = KNOWN_PAYSTACK_STATUSES.find((status) => status === paystackStatus);
  return match ?? 'other';
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Paystack's REST API directly — no SDK dependency, matching this codebase's own Resend-sender
// precedent (apps/api/src/lib/email/resend.ts) for the same reason: a handful of plain fetch
// calls don't need a wrapper library. Requires PAYSTACK_SECRET_KEY (a Worker secret,
// `wrangler secret put PAYSTACK_SECRET_KEY`) — a test-mode (`sk_test_...`) or live key both work
// unchanged, since Paystack itself decides sandbox-vs-live purely from which key was used.
export function createPaystackProvider(env: Bindings): PaymentProvider {
  const secretKey = env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('createPaystackProvider called without PAYSTACK_SECRET_KEY set — call getPaymentProvider(env) instead');
  }

  return {
    configured: true,

    async initializeTransaction(input: InitializePaymentInput): Promise<InitializePaymentResult> {
      const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: input.amount,
          currency: input.currency,
          email: input.email,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        }),
      });
      const body = await response.json<PaystackInitializeResponse>();
      if (!response.ok || !body.status || !body.data) {
        throw new Error(`Paystack initialize-transaction failed: ${body.message ?? response.statusText}`);
      }
      return { authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code, reference: body.data.reference };
    },

    async verifyTransaction(reference: string): Promise<VerifyPaymentResult> {
      const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const body = await response.json<PaystackVerifyResponse>();
      if (!response.ok || !body.status || !body.data) {
        throw new Error(`Paystack verify-transaction failed: ${body.message ?? response.statusText}`);
      }
      return {
        status: toTransactionStatus(body.data.status),
        reference: body.data.reference,
        amount: body.data.amount,
        currency: body.data.currency,
        raw: body.data,
      };
    },

    // Paystack signs the raw request body with HMAC-SHA512 using the very same secret key used
    // to authenticate outbound API calls (no separate webhook signing secret exists to configure)
    // — https://paystack.com/docs/payments/webhooks/. constantTimeEqual (already a dependency via
    // better-auth, used the same way for this project's own password-reset/recovery-code token
    // comparisons) avoids a timing side-channel on the comparison.
    async verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): Promise<boolean> {
      if (!signatureHeader) return false;
      const expected = await hmacSha512Hex(secretKey, rawBody);
      return constantTimeEqual(expected, signatureHeader);
    },

    // Never the key itself — only which of Paystack's two documented prefixes it starts with
    // (https://paystack.com/docs/payments/test-payments/). Local and synchronous: no network call
    // to Paystack, since this is a developer-facing status readout, not a live credential check.
    getStatus(): PaymentProviderStatus {
      if (secretKey.startsWith('sk_test_')) return { configured: true, environment: 'test' };
      if (secretKey.startsWith('sk_live_')) return { configured: true, environment: 'live' };
      return { configured: true, environment: 'unknown' };
    },
  };
}
