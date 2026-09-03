import type { WebhookEvent } from '@kenresoft-cms/contracts';
import type { Database, Webhook } from '@kenresoft-cms/database';

import {
  listDeliveriesToRetry,
  listEnabledWebhooksForContentType,
  recordWebhookDelivery,
} from '../repositories/webhooks';

// Only the one method this module actually uses, rather than the full Cloudflare
// `ExecutionContext` type — two different `@cloudflare/workers-types` versions coexist in this
// monorepo's dependency tree (confirmed via `pnpm install`'s own peer-dependency warnings), and
// Hono's `c.executionCtx` resolves to a structurally different one (`tracing`/`abort` fields)
// than the plain global `ExecutionContext` used in index.ts's `scheduled` handler. Both actual
// values satisfy this minimal shape regardless of which package version typed them.
type WaitUntilContext = Pick<ExecutionContext, 'waitUntil'>;

// Never client-supplied (routes/admin/webhooks.ts) — a webhook secret's entire purpose is
// proving a delivery actually came from this deployment, so it has to be something a caller
// can't pick or guess. Web Crypto's getRandomValues, not Math.random, for the same reason
// BETTER_AUTH_SECRET is generated this way in scripts/setup.mjs.
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const MAX_DELIVERY_ATTEMPTS = 5;

// Attempts a single delivery and records the outcome as a new webhook_deliveries row — never
// throws, since a subscriber's endpoint being down/slow/broken must never affect the entry
// write that triggered this. Called via ctx.waitUntil() from the route handler, so its own
// duration doesn't hold up the response the editor is waiting on.
async function attemptDelivery(
  db: Database,
  webhook: Pick<Webhook, 'id' | 'url' | 'secret'>,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  attempt: number,
): Promise<void> {
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  let responseStatus: number | null = null;
  let success = false;

  try {
    const signature = await signPayload(webhook.secret, body);
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kenresoft-Event': event,
        'X-Kenresoft-Signature': signature,
      },
      body,
    });
    responseStatus = response.status;
    success = response.ok;
  } catch {
    // Network error, DNS failure, timeout, etc. — responseStatus stays null, distinct from a
    // real non-2xx response the endpoint actually returned.
  }

  await recordWebhookDelivery(db, { webhookId: webhook.id, event, payload, responseStatus, success, attempt });
}

// Called from routes/admin/entries.ts after a create/update/delete/status-change commits —
// looks up every enabled webhook that matches this content type (or has no content-type scope
// at all) and subscribes to this event, then fires each independently. One webhook's failure
// never affects another's delivery.
export function dispatchWebhookEvent(
  db: Database,
  ctx: WaitUntilContext,
  event: WebhookEvent,
  contentTypeId: string,
  payload: Record<string, unknown>,
): void {
  ctx.waitUntil(
    (async () => {
      const matching = await listEnabledWebhooksForContentType(db, contentTypeId);
      const subscribed = matching.filter((webhook) => webhook.events.includes(event));
      await Promise.all(subscribed.map((webhook) => attemptDelivery(db, webhook, event, payload, 1)));
    })(),
  );
}

// Called from the existing 5-minute Cron Trigger (index.ts) alongside scheduled publishing —
// re-delivers any failed attempt under MAX_DELIVERY_ATTEMPTS, reusing the original payload
// so a retry never needs to re-derive anything from the entry that triggered it (which may
// since have changed or been deleted). A webhook deleted since its failed delivery is silently
// skipped (join returns nothing to retry against).
export async function retryFailedWebhookDeliveries(db: Database, ctx: WaitUntilContext): Promise<void> {
  const toRetry = await listDeliveriesToRetry(db, MAX_DELIVERY_ATTEMPTS);
  ctx.waitUntil(
    Promise.all(
      toRetry.map(({ delivery, webhook }) =>
        attemptDelivery(db, webhook, delivery.event, delivery.payload, delivery.attempt + 1),
      ),
    ),
  );
}
