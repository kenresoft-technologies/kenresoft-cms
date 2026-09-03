import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { contentTypes } from './content-types';
import type { WebhookEvent } from '@kenresoft-cms/contracts';

export type { WebhookEvent };

// `secret` (HMAC-signing key for delivered payloads, apps/api/src/lib/webhooks.ts) is
// server-generated at creation, never client-supplied — same reasoning as BETTER_AUTH_SECRET:
// a value whose entire purpose is proving authenticity shouldn't be something a caller can pick
// or guess. `contentTypeId` nullable = fires for every content type; scoped to one otherwise.
export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    url: text('url').notNull(),
    events: text('events', { mode: 'json' }).notNull().$type<WebhookEvent[]>(),
    contentTypeId: text('content_type_id').references(() => contentTypes.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('webhooks_content_type_id_idx').on(table.contentTypeId)],
);

// One row per delivery attempt (not per webhook-event) — a retried delivery inserts a new row
// with attempt > 1 rather than updating the original, so the log is a real audit trail of every
// attempt, not just the latest outcome. `responseStatus` is null when the request never
// completed at all (network error, timeout, DNS failure), distinct from a real non-2xx status.
export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull().$type<WebhookEvent>(),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    responseStatus: integer('response_status'),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    attempt: integer('attempt').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('webhook_deliveries_webhook_id_idx').on(table.webhookId)],
);

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
