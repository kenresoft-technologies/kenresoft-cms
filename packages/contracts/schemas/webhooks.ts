import { z } from 'zod';

import { WEBHOOK_EVENTS } from './enums';

// `secret` is deliberately never part of the normal read shape (list/get) — same "shown once,
// never returned again" boundary as 2FA's backup codes and BETTER_AUTH_SECRET. It's only ever
// present in the response right after a create or a regenerate-secret action, via
// webhookWithSecretSchema below.
export const webhookSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  // null = fires for every content type; a real id scopes it to just that one.
  contentTypeId: z.string().nullable(),
  enabled: z.boolean(),
  // Explicit per-webhook opt-in to deliver to a localhost/private-network/link-local/metadata
  // destination (apps/api/src/lib/ssrf-guard.ts) — false unless an admin deliberately turns it
  // on for a genuinely internal target (a self-hosted automation tool on the same network,
  // localhost during testing).
  allowPrivateDestinations: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const webhookWithSecretSchema = webhookSchema.extend({
  secret: z.string(),
});

export const createWebhookSchema = z.object({
  // No hostname-shape constraint beyond http(s) here — a real deployment's webhook target could
  // legitimately be an internal hostname as well as a public domain. Whether a given hostname/
  // IP is actually reachable is a server-side check (checkWebhookUrl, apps/api/src/lib/
  // ssrf-guard.ts), not something this shape-only schema can decide — it needs the sibling
  // allowPrivateDestinations field, and a DNS-blind first pass over an IP literal is still worth
  // doing without a network round trip.
  url: z.url({ protocol: /^https?$/ }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Select at least one event'),
  contentTypeId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  allowPrivateDestinations: z.boolean().optional(),
});

export const updateWebhookSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Select at least one event').optional(),
  contentTypeId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  allowPrivateDestinations: z.boolean().optional(),
});

export const webhookDeliverySchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  event: z.enum(WEBHOOK_EVENTS),
  payload: z.record(z.string(), z.unknown()),
  responseStatus: z.number().nullable(),
  success: z.boolean(),
  attempt: z.number(),
  createdAt: z.string(),
});

export type Webhook = z.infer<typeof webhookSchema>;
export type WebhookWithSecret = z.infer<typeof webhookWithSecretSchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
