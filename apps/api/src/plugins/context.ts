import { createDb } from '@kenresoft-cms/database';
import { roleAtLeast } from '@kenresoft-cms/contracts';
import type {
  PluginBindings,
  PluginConfigService,
  PluginContext,
  PluginLogger,
  PluginMediaService,
  PluginRegistration,
  PluginVariables,
} from '@kenresoft-cms/plugin-sdk';
import type { Database } from '@kenresoft-cms/database';
import type { MiddlewareHandler } from 'hono';

import { deleteMediaFile, getMedia, uploadMedia } from '../lib/media-service';
import { getPluginSettingsRow, upsertPluginConfig } from '../repositories/plugin-settings';
import { pluginEventBus } from './events';

// Wraps apps/api/src/lib/media-service.ts's exact upload/delete code path — the same one
// routes/admin/media.ts uses — so a plugin never touches R2 or the media table directly.
function createPluginMediaService(db: Database, bucket: R2Bucket): PluginMediaService {
  return {
    async get(id) {
      const row = await getMedia(db, id);
      if (!row) return null;
      return {
        id: row.id,
        filename: row.filename,
        contentType: row.contentType,
        size: row.size,
        width: row.width,
        height: row.height,
      };
    },
    async upload(input) {
      const result = await uploadMedia(db, bucket, { bytes: input.bytes, filename: input.filename, altText: null });
      if (!result.ok) {
        throw new Error(result.error);
      }
      const row = result.media;
      return {
        id: row.id,
        filename: row.filename,
        contentType: row.contentType,
        size: row.size,
        width: row.width,
        height: row.height,
      };
    },
    async delete(id) {
      const row = await deleteMediaFile(db, bucket, id);
      return row !== null;
    },
  };
}

// Core's own repository/table (packages/database/schema/plugin-settings.ts) stays 100% generic
// JSON in/out — validation against the plugin's OWN Zod schema happens only here, at the
// boundary where a plugin actually reads/writes its config.
function createPluginConfigService(db: Database, plugin: PluginRegistration): PluginConfigService {
  return {
    async get() {
      const row = await getPluginSettingsRow(db, plugin.manifest.id);
      const raw = row?.config ?? {};
      return plugin.configSchema ? plugin.configSchema.parse(raw) : raw;
    },
    async set(value) {
      const parsed = plugin.configSchema ? plugin.configSchema.parse(value) : value;
      await upsertPluginConfig(db, plugin.manifest.id, parsed as Record<string, unknown>);
    },
  };
}

function createPluginLogger(pluginId: string): PluginLogger {
  const prefix = `[plugin:${pluginId}]`;
  return {
    info: (message, meta) => console.log(prefix, message, meta ?? ''),
    warn: (message, meta) => console.warn(prefix, message, meta ?? ''),
    error: (message, meta) => console.error(prefix, message, meta ?? ''),
  };
}

// Populates c.get('pluginContext') for one plugin's mount point. Registered on the plugin's OWN
// sub-app (apps/api/src/plugins/mount.ts calls plugin.routes.use('*', ...)), not the top-level
// app — the top-level app's Variables type (AuthedVariables) has no `pluginContext` field to
// c.set() into, while the plugin's own PluginVariables env declares it. `c.get('user')` here
// still sees the real session: requireSession runs first, on the same shared request Context,
// before dispatch ever reaches this sub-app (mirrors how every other route file in this repo
// already relies on a middleware registered earlier in the chain, not a redeclared type, to
// guarantee a variable is actually present at runtime).
export function createPluginContextMiddleware(
  plugin: PluginRegistration,
): MiddlewareHandler<{ Bindings: PluginBindings; Variables: PluginVariables }> {
  return async (c, next) => {
    const db = createDb(c.env.DB);
    const user = c.get('user');
    const ctx: PluginContext = {
      pluginId: plugin.manifest.id,
      db,
      user,
      hasRole: (minimum) => roleAtLeast(user.role, minimum),
      media: createPluginMediaService(db, c.env.MEDIA_BUCKET),
      config: createPluginConfigService(db, plugin),
      events: pluginEventBus,
      logger: createPluginLogger(plugin.manifest.id),
    };
    c.set('pluginContext', ctx);
    await next();
  };
}
