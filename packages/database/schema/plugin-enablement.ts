import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Core's own registry bookkeeping — which bundled plugins are currently turned on — kept
// separate from plugin_settings (a plugin's own opaque config, Phase 1) since this is a Core
// concern about the platform, not any one plugin's data. No row for a given plugin id means
// enabled by default (an operator opts a plugin OUT, not in — matching the previous static
// plugins.config.ts's default-on behavior). See docs/PLUGINS.md's Enablement section.
export const pluginEnablement = sqliteTable('plugin_enablement', {
  pluginId: text('plugin_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type PluginEnablementRow = typeof pluginEnablement.$inferSelect;
export type NewPluginEnablementRow = typeof pluginEnablement.$inferInsert;
