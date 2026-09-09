import { createRoute } from '@hono/zod-openapi';
import {
  createWebhookSchema,
  idParamSchema,
  updateWebhookSchema,
  webhookDeliverySchema,
  webhookSchema,
  webhookWithSecretSchema,
} from '@kenresoft-cms/contracts';
import type { Webhook, WebhookDelivery, WebhookWithSecret } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { generateWebhookSecret } from '../../lib/webhooks';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { getContentTypeById } from '../../repositories/content-types';
import {
  createWebhook,
  deleteWebhook,
  getWebhookById,
  listWebhookDeliveries,
  listWebhooks,
  regenerateWebhookSecret,
  updateWebhook,
} from '../../repositories/webhooks';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Webhook as DbWebhook, WebhookDelivery as DbWebhookDelivery } from '@kenresoft-cms/database';

// Every route here is admin-and-above only, stricter than content-types/forms (which admit
// editor for field-level edits) — a webhook's own signing secret and its ability to make this
// deployment POST arbitrary JSON to any URL an admin chooses make this closer to a structural,
// security-relevant capability than day-to-day editorial work.
export const webhooksRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });

function toWebhook(row: DbWebhook): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    contentTypeId: row.contentTypeId,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWebhookWithSecret(row: DbWebhook): WebhookWithSecret {
  return { ...toWebhook(row), secret: row.secret };
}

function toDelivery(row: DbWebhookDelivery): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    payload: row.payload,
    responseStatus: row.responseStatus,
    success: row.success,
    attempt: row.attempt,
    createdAt: row.createdAt.toISOString(),
  };
}

webhooksRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Webhooks'],
    summary: 'List every webhook (admin only)',
    middleware: requireRole('admin'),
    responses: {
      200: {
        description: 'Every configured webhook. Never includes the signing secret.',
        content: { 'application/json': { schema: z.array(webhookSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listWebhooks(db)).map(toWebhook), 200);
  },
);

webhooksRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Webhooks'],
    summary: 'Create a webhook (admin only)',
    middleware: requireRole('admin'),
    request: {
      body: { content: { 'application/json': { schema: createWebhookSchema } } },
    },
    responses: {
      201: {
        description: "The created webhook, including its signing secret — shown only this once.",
        content: { 'application/json': { schema: webhookWithSecretSchema } },
      },
      400: {
        description: 'contentTypeId does not reference a real content type.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);

    if (input.contentTypeId && !(await getContentTypeById(db, input.contentTypeId))) {
      return c.json({ error: 'No content type with that id' }, 400);
    }

    const created = await createWebhook(db, {
      url: input.url,
      events: input.events,
      contentTypeId: input.contentTypeId ?? null,
      enabled: input.enabled ?? true,
      secret: generateWebhookSecret(),
    });
    return c.json(toWebhookWithSecret(created), 201);
  },
);

webhooksRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Webhooks'],
    summary: 'Update a webhook (admin only)',
    middleware: requireRole('admin'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateWebhookSchema } } },
    },
    responses: {
      200: {
        description: 'The updated webhook.',
        content: { 'application/json': { schema: webhookSchema } },
      },
      400: {
        description: 'contentTypeId does not reference a real content type.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No webhook with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);

    const existing = await getWebhookById(db, id);
    if (!existing) {
      return c.json({ error: 'Webhook not found' }, 404);
    }
    if (input.contentTypeId && !(await getContentTypeById(db, input.contentTypeId))) {
      return c.json({ error: 'No content type with that id' }, 400);
    }

    const updated = await updateWebhook(db, id, input);
    return c.json(toWebhook(updated!), 200);
  },
);

webhooksRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/regenerate-secret',
    tags: ['Webhooks'],
    summary: "Regenerate a webhook's signing secret (admin only)",
    middleware: requireRole('admin'),
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The webhook with its new secret — shown only this once. The old secret stops working immediately.',
        content: { 'application/json': { schema: webhookWithSecretSchema } },
      },
      404: {
        description: 'No webhook with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);

    const existing = await getWebhookById(db, id);
    if (!existing) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    const updated = await regenerateWebhookSecret(db, id, generateWebhookSecret());
    return c.json(toWebhookWithSecret(updated!), 200);
  },
);

webhooksRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/deliveries',
    tags: ['Webhooks'],
    summary: 'List recent delivery attempts for a webhook (admin only)',
    middleware: requireRole('admin'),
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The 50 most recent delivery attempts, newest first.',
        content: { 'application/json': { schema: z.array(webhookDeliverySchema) } },
      },
      404: {
        description: 'No webhook with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);

    const existing = await getWebhookById(db, id);
    if (!existing) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    return c.json((await listWebhookDeliveries(db, id)).map(toDelivery), 200);
  },
);

webhooksRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Webhooks'],
    summary: 'Delete a webhook (admin only)',
    middleware: requireRole('admin'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The webhook (and its delivery log) was deleted.' },
      404: {
        description: 'No webhook with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);

    const existing = await getWebhookById(db, id);
    if (!existing) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    await deleteWebhook(db, id);
    return c.body(null, 204);
  },
);
