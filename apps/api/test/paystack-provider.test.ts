import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPaymentProvider } from '../src/lib/payments';
import { createPaystackProvider } from '../src/lib/payments/paystack';
import type { Bindings } from '../src/lib/env';

// Mocks `fetch` rather than making real calls to https://api.paystack.co, for the same reason
// plugin-rate-limit.test.ts mocks the rate-limit binding's own `.limit()` instead of driving the
// real thing: this file is about createPaystackProvider's own request-shaping/response-parsing
// logic, not Paystack's live API. No real Paystack credentials exist for this automated suite —
// commerce-payments.test.ts covers the routes that call this provider, also with fetch mocked;
// a real end-to-end pass against Paystack's actual sandbox is a separate, manual verification
// step once real test-mode credentials are available (docs/PLUGINS.md's Commerce section).
function envWith(secretKey: string | undefined): Bindings {
  return { PAYSTACK_SECRET_KEY: secretKey } as unknown as Bindings;
}

describe('getPaymentProvider', () => {
  it('returns the noop provider when PAYSTACK_SECRET_KEY is unset', () => {
    const provider = getPaymentProvider(envWith(undefined));
    expect(provider.configured).toBe(false);
  });

  it('returns a configured Paystack provider when PAYSTACK_SECRET_KEY is set', () => {
    const provider = getPaymentProvider(envWith('sk_test_abc'));
    expect(provider.configured).toBe(true);
  });
});

describe('noop payment provider', () => {
  it('throws on initializeTransaction/verifyTransaction, and rejects every webhook signature', async () => {
    const provider = getPaymentProvider(envWith(undefined));
    await expect(
      provider.initializeTransaction({ amount: 100, currency: 'NGN', email: 'a@example.test', reference: 'r', callbackUrl: 'https://x.test' }),
    ).rejects.toThrow();
    await expect(provider.verifyTransaction('r')).rejects.toThrow();
    await expect(provider.verifyWebhookSignature('{}', 'anything')).resolves.toBe(false);
  });
});

describe('Paystack provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializeTransaction posts the right shape and parses a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: 'Authorization URL created',
          data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'abc', reference: 'ref-1' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createPaystackProvider(envWith('sk_test_abc'));
    const result = await provider.initializeTransaction({
      amount: 5000,
      currency: 'NGN',
      email: 'buyer@example.test',
      reference: 'ref-1',
      callbackUrl: 'https://storefront.example/thank-you',
    });

    expect(result).toEqual({ authorizationUrl: 'https://checkout.paystack.com/abc', accessCode: 'abc', reference: 'ref-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.headers.Authorization).toBe('Bearer sk_test_abc');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ amount: 5000, currency: 'NGN', email: 'buyer@example.test', reference: 'ref-1', callback_url: 'https://storefront.example/thank-you' });
  });

  it('initializeTransaction throws a clear error when Paystack rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: false, message: 'Invalid key' }), { status: 401 })),
    );

    const provider = createPaystackProvider(envWith('sk_test_invalid'));
    await expect(
      provider.initializeTransaction({ amount: 100, currency: 'NGN', email: 'a@example.test', reference: 'r', callbackUrl: 'https://x.test' }),
    ).rejects.toThrow(/Invalid key/);
  });

  it('verifyTransaction parses a successful verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: true, message: 'Verification successful', data: { status: 'success', reference: 'ref-1', amount: 5000, currency: 'NGN' } }),
          { status: 200 },
        ),
      ),
    );

    const provider = createPaystackProvider(envWith('sk_test_abc'));
    const result = await provider.verifyTransaction('ref-1');
    expect(result).toMatchObject({ status: 'success', reference: 'ref-1', amount: 5000, currency: 'NGN' });
  });

  it('verifyTransaction maps every non-success Paystack status to this provider’s own status vocabulary', async () => {
    for (const [paystackStatus, expected] of [
      ['failed', 'failed'],
      ['abandoned', 'abandoned'],
      ['reversed', 'other'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ status: true, message: 'ok', data: { status: paystackStatus, reference: 'r', amount: 1, currency: 'NGN' } }), {
            status: 200,
          }),
        ),
      );
      const provider = createPaystackProvider(envWith('sk_test_abc'));
      const result = await provider.verifyTransaction('r');
      expect(result.status).toBe(expected);
    }
  });

  it('verifyWebhookSignature accepts a correctly signed body and rejects a tampered one', async () => {
    const provider = createPaystackProvider(envWith('sk_test_abc'));
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-1' } });

    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('sk_test_abc'), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const validSignature = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await expect(provider.verifyWebhookSignature(body, validSignature)).resolves.toBe(true);
    await expect(provider.verifyWebhookSignature(body, `${validSignature.slice(0, -1)}0`)).resolves.toBe(false);
    await expect(provider.verifyWebhookSignature(body, undefined)).resolves.toBe(false);
    await expect(provider.verifyWebhookSignature(`${body} `, validSignature)).resolves.toBe(false);
  });
});
