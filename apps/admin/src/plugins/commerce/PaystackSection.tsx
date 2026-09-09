import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, RefreshCw } from 'lucide-react';

import { API_URL, ApiError } from '@/lib/api-client';
import { CodeBlock } from '@/components/code-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type CommercePaymentStatus, useCheckCommercePaymentStatus } from './queries';

const WEBHOOK_PATH = '/api/plugins/commerce/public/v1/payments/webhook';

// This section is deliberately a status/instructions surface, never a secrets vault — there is
// no field anywhere here that accepts a Paystack key of any kind, and no Paystack *public* key
// is ever asked for either: the integration is server-redirect-only (Initialize Transaction ->
// hosted checkout -> callback), never Paystack's inline/popup JS widget, so a public key is
// simply not part of this flow at all (docs/PLUGINS.md's Commerce section,
// apps/api/src/lib/payments/paystack.ts). PAYSTACK_SECRET_KEY lives only as a Cloudflare Worker
// secret, set via `wrangler secret put` / `.dev.vars` — this page can only report a non-sensitive
// readout of it (GET /api/plugins/commerce/v1/settings/payment-status: provider/configured/
// environment, derived from the key's own sk_test_/sk_live_ prefix, never the key itself).
export function PaystackSection() {
  const checkStatus = useCheckCommercePaymentStatus();
  const [result, setResult] = useState<CommercePaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webhookUrl = `${API_URL}${WEBHOOK_PATH}`;

  async function handleVerify() {
    setError(null);
    try {
      const status = await checkStatus.mutateAsync();
      setResult(status);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : 'Failed to check payment configuration');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments (Paystack)</CardTitle>
        <CardDescription>
          Kenresoft uses Paystack's hosted checkout — Initialize a transaction, redirect the
          customer to Paystack's own page, then confirm the result server-side. Your Paystack
          secret key is stored as a Cloudflare Worker secret and is never stored in the CMS
          database, returned by any API response, or logged anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Verify configuration</p>
              <p className="text-sm text-muted-foreground">
                Checks whether this deployment's Worker has a <code className="rounded bg-muted px-1 py-0.5 text-xs">PAYSTACK_SECRET_KEY</code>{' '}
                set, and which environment it's for — never the key itself.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={checkStatus.isPending}
              onClick={() => void handleVerify()}
            >
              <RefreshCw className={checkStatus.isPending ? 'size-3.5 animate-spin' : 'size-3.5'} />
              {checkStatus.isPending ? 'Checking…' : 'Verify configuration'}
            </Button>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                <Badge
                  variant="outline"
                  className={
                    result.configured
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  }
                >
                  {result.configured ? 'Configured' : 'Not configured'}
                </Badge>
                {result.configured ? (
                  <Badge
                    variant="outline"
                    className={
                      result.environment === 'live'
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : result.environment === 'test'
                          ? 'border-primary/25 bg-primary/10 text-primary'
                          : 'border-border bg-muted text-muted-foreground'
                    }
                  >
                    Environment: {result.environment.toUpperCase()}
                  </Badge>
                ) : null}
              </div>

              {result.configured && result.environment === 'live' ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    This deployment is using a <strong>live</strong> Paystack key. Real transactions
                    will be processed and real money will move — make sure that's intentional
                    before customers start checking out.
                  </span>
                </div>
              ) : null}

              {result.configured && result.environment === 'test' ? (
                <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/10 p-3 text-sm text-primary">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>Using a test-mode key — no real money moves. Safe for development and QA.</span>
                </div>
              ) : null}

              {!result.configured ? (
                <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Commerce still works — you can manage products, categories, and orders as
                    usual. Payment initialization is simply disabled until a Paystack secret key
                    is set for this deployment (see the setup instructions below).
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Setup</p>
          <p className="text-sm text-muted-foreground">
            Local development — add to <code className="rounded bg-muted px-1 py-0.5 text-xs">apps/api/.dev.vars</code>:
          </p>
          <CodeBlock label=".dev.vars" code={'PAYSTACK_SECRET_KEY=sk_test_your_test_key_here'} />

          <p className="text-sm text-muted-foreground">Deployed environments — set it as a Worker secret:</p>
          <CodeBlock label="Shell" code={'wrangler secret put PAYSTACK_SECRET_KEY'} />

          <p className="text-sm text-muted-foreground">
            Use a key starting <code className="rounded bg-muted px-1 py-0.5 text-xs">sk_test_</code> while
            developing or testing, and one starting <code className="rounded bg-muted px-1 py-0.5 text-xs">sk_live_</code> for
            production — Paystack itself decides sandbox-vs-live purely from which secret key you
            use, nothing else needs to change here. This CMS never displays, returns, logs, or
            persists the actual value once set. There is no public/inline key involved anywhere
            in this integration — the hosted-checkout flow doesn't need one.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Webhook URL</p>
          <p className="text-sm text-muted-foreground">
            Register this URL in the Paystack dashboard under{' '}
            <span className="font-medium">Settings → API Keys &amp; Webhooks</span>, so Paystack
            can notify this deployment when a payment completes even if the customer never returns
            to the callback page.
          </p>
          <CodeBlock label="Webhook URL" code={webhookUrl} />
        </div>

        <div className="flex flex-wrap gap-4 border-t pt-4">
          <a
            href="https://dashboard.paystack.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Paystack dashboard
            <ExternalLink className="size-3.5" />
          </a>
          <a
            href="https://paystack.com/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Paystack docs
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
