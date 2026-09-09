import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Core-owned generic infrastructure any enabled plugin can use for its own non-secret,
// validated configuration (@kenresoft-cms/plugin-sdk's PluginConfigService) — one row per
// plugin, not a plugin-specific table, since config storage is a cross-cutting mechanism every
// plugin needs identically. `config`'s meaning is entirely up to the plugin (validated against
// its own Zod schema, apps/api/src/plugins/context.ts); this table stays 100% generic JSON in/
// out. Never store secrets here — payment-provider keys, API tokens, anything deployment-
// sensitive belongs behind `wrangler secret put` instead (docs/PLUGINS.md, mirroring how
// docs/DEPLOYMENT.md already treats BETTER_AUTH_SECRET/OWNER_RECOVERY_SECRET).
export const pluginSettings = sqliteTable('plugin_settings', {
  pluginId: text('plugin_id').primaryKey(),
  config: text('config', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  // Lets a future plugin ship a config-shape migration (e.g. renaming a key) with a real "what
  // shape is this row" marker to branch on, instead of a fragile guess-the-old-shape read path.
  configVersion: integer('config_version').notNull().default(1),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type PluginSettingsRow = typeof pluginSettings.$inferSelect;
export type NewPluginSettingsRow = typeof pluginSettings.$inferInsert;
