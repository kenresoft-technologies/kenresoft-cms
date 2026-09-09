import { createRoute } from '@hono/zod-openapi';
import {
  legacyMigrationReportSchema,
  structuredSettingsDataSchemaByModule,
  structuredSettingsModuleSchema,
  structuredSettingsRowSchema,
} from '@kenresoft-cms/contracts';
import type { LegacyMigrationReport, StructuredSettingsModule, StructuredSettingsRow } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { migrateLegacyGlobalVariables } from '../../lib/legacy-settings-migration';
import { createOpenApiApp } from '../../lib/openapi';
import { invalidatePublicStructuredSettingsCache } from '../../lib/public-cache';
import { requireRole } from '../../middleware/require-role';
import { getStructuredSettings, listStructuredSettings, upsertStructuredSettings } from '../../repositories/structured-settings';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { StructuredSettingsRow as DbStructuredSettingsRow } from '@kenresoft-cms/database';

export const structuredSettingsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });

const moduleParamSchema = z.object({ module: structuredSettingsModuleSchema });

function toStructuredSettingsRow(row: DbStructuredSettingsRow): StructuredSettingsRow {
  return {
    id: row.id,
    module: row.module,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

structuredSettingsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Structured settings'],
    summary: 'List every configured Structured Settings module',
    responses: {
      200: {
        description: 'Every module that has been saved at least once (modules never saved are omitted).',
        content: { 'application/json': { schema: z.array(structuredSettingsRowSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listStructuredSettings(db)).map(toStructuredSettingsRow), 200);
  },
);

structuredSettingsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{module}',
    tags: ['Structured settings'],
    summary: 'Get one Structured Settings module',
    request: { params: moduleParamSchema },
    responses: {
      200: {
        description: 'The module row, or null if it has never been saved.',
        content: { 'application/json': { schema: structuredSettingsRowSchema.nullable() } },
      },
    },
  }),
  async (c) => {
    const { module } = c.req.valid('param');
    const db = getDb(c);
    const row = await getStructuredSettings(db, module);
    return c.json(row ? toStructuredSettingsRow(row) : null);
  },
);

// Admin-only, same tier as the CMS-internal Settings singleton (routes/admin/settings.ts) — a
// site-wide configuration write, not day-to-day editorial work.
structuredSettingsRoute.openapi(
  createRoute({
    method: 'put',
    path: '/{module}',
    tags: ['Structured settings'],
    summary: 'Update one Structured Settings module (admin only)',
    middleware: requireRole('admin'),
    request: {
      params: moduleParamSchema,
      // Each module's `data` shape is validated by hand in the handler below (per-module
      // schema keyed off the path param) rather than here, since @hono/zod-openapi's static
      // request-body schema can't vary by a sibling path param.
      body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
    },
    responses: {
      200: {
        description: 'The updated module row.',
        content: { 'application/json': { schema: structuredSettingsRowSchema } },
      },
      400: {
        description: "The body didn't match this module's schema.",
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { module } = c.req.valid('param');
    const body = c.req.valid('json');

    const dataSchema = structuredSettingsDataSchemaByModule[module as StructuredSettingsModule];
    const parsed = dataSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') }, 400);
    }

    const db = getDb(c);
    const row = await upsertStructuredSettings(db, module, parsed.data);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'structured_settings.updated',
      targetType: 'structured_settings',
      targetId: module,
    });
    c.executionCtx.waitUntil(invalidatePublicStructuredSettingsCache(module));
    return c.json(toStructuredSettingsRow(row), 200);
  },
);

// One-time (per module), idempotent, admin-triggered import from Global Variables — never runs
// automatically, since silently writing to a new domain the first time an admin merely opens a
// page would be surprising. Only known legacy keys are ever read; every other Global Variable
// is left completely untouched. See lib/legacy-settings-migration.ts for the exact mapping.
structuredSettingsRoute.openapi(
  createRoute({
    method: 'post',
    path: '/migrate-legacy',
    tags: ['Structured settings'],
    summary: 'Import known legacy Global Variable keys into Structured Settings (admin only)',
    middleware: requireRole('admin'),
    responses: {
      200: {
        description: 'A report of what was migrated, what was already populated, and what was skipped.',
        content: { 'application/json': { schema: legacyMigrationReportSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const report: LegacyMigrationReport = await migrateLegacyGlobalVariables(db);
    if (report.migratedModules.length > 0) {
      await recordAudit(db, {
        actorUserId: c.get('user').id,
        action: 'structured_settings.legacy_migrated',
        targetType: 'structured_settings',
        metadata: { ...report },
      });
      await Promise.all(report.migratedModules.map((module) => invalidatePublicStructuredSettingsCache(module)));
    }
    return c.json(report, 200);
  },
);
