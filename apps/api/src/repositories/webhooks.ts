import { and, desc, eq, isNull, lt, or, webhookDeliveries, webhooks } from '@kenresoft-cms/database';
import type { Database, NewWebhook, NewWebhookDelivery, Webhook, WebhookDelivery } from '@kenresoft-cms/database';
import type { UpdateWebhookInput } from '@kenresoft-cms/contracts';

export function listWebhooks(db: Database): Promise<Webhook[]> {
  return db.query.webhooks.findMany({ orderBy: desc(webhooks.createdAt) });
}

export function getWebhookById(db: Database, id: string): Promise<Webhook | undefined> {
  return db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
}

// A webhook with no contentTypeId fires for every content type; one with a real id only fires
// for that one. `enabled = false` is excluded here rather than at the call site, so every
// caller automatically respects it.
export function listEnabledWebhooksForContentType(db: Database, contentTypeId: string): Promise<Webhook[]> {
  return db.query.webhooks.findMany({
    where: and(eq(webhooks.enabled, true), or(isNull(webhooks.contentTypeId), eq(webhooks.contentTypeId, contentTypeId))),
  });
}

export async function createWebhook(
  db: Database,
  input: Pick<NewWebhook, 'url' | 'events' | 'contentTypeId' | 'enabled'> & { secret: string },
): Promise<Webhook> {
  const [row] = await db.insert(webhooks).values(input).returning();
  return row!;
}

export async function updateWebhook(
  db: Database,
  id: string,
  input: UpdateWebhookInput,
): Promise<Webhook | undefined> {
  const [row] = await db
    .update(webhooks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(webhooks.id, id))
    .returning();
  return row;
}

export async function regenerateWebhookSecret(db: Database, id: string, secret: string): Promise<Webhook | undefined> {
  const [row] = await db.update(webhooks).set({ secret, updatedAt: new Date() }).where(eq(webhooks.id, id)).returning();
  return row;
}

export async function deleteWebhook(db: Database, id: string): Promise<void> {
  await db.delete(webhooks).where(eq(webhooks.id, id));
}

export function listWebhookDeliveries(db: Database, webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
  return db.query.webhookDeliveries.findMany({
    where: eq(webhookDeliveries.webhookId, webhookId),
    orderBy: desc(webhookDeliveries.createdAt),
    limit,
  });
}

export async function recordWebhookDelivery(
  db: Database,
  input: Pick<NewWebhookDelivery, 'webhookId' | 'event' | 'payload' | 'responseStatus' | 'success' | 'attempt'>,
): Promise<WebhookDelivery> {
  const [row] = await db.insert(webhookDeliveries).values(input).returning();
  return row!;
}

// Joined so a retry has the webhook's current url/secret to hand — both may have changed (or
// the webhook may have been disabled) since the original failed attempt.
export async function listDeliveriesToRetry(
  db: Database,
  maxAttempts: number,
): Promise<Array<{ delivery: WebhookDelivery; webhook: Webhook }>> {
  const rows = await db
    .select({ delivery: webhookDeliveries, webhook: webhooks })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(and(eq(webhookDeliveries.success, false), lt(webhookDeliveries.attempt, maxAttempts), eq(webhooks.enabled, true)));
  return rows;
}
