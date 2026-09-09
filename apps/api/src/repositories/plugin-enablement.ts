import { eq, pluginEnablement } from '@kenresoft-cms/database';
import type { Database, PluginEnablementRow } from '@kenresoft-cms/database';

export function getPluginEnablementRow(db: Database, pluginId: string): Promise<PluginEnablementRow | undefined> {
  return db.query.pluginEnablement.findFirst({ where: eq(pluginEnablement.pluginId, pluginId) });
}

export function listPluginEnablementRows(db: Database): Promise<PluginEnablementRow[]> {
  return db.query.pluginEnablement.findMany();
}

// No row for a plugin id means enabled (docs/PLUGINS.md) — an operator opts a plugin OUT, not in.
export async function isPluginEnabled(db: Database, pluginId: string): Promise<boolean> {
  const row = await getPluginEnablementRow(db, pluginId);
  return row?.enabled ?? true;
}

// One row per plugin (pluginId is the primary key) — update the existing row if there is one,
// otherwise create it, matching repositories/settings.ts's/plugin-settings.ts's exact
// singleton-upsert idiom.
export async function setPluginEnabled(db: Database, pluginId: string, enabled: boolean): Promise<PluginEnablementRow> {
  const existing = await getPluginEnablementRow(db, pluginId);

  if (existing) {
    const [row] = await db
      .update(pluginEnablement)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(pluginEnablement.pluginId, pluginId))
      .returning();
    return row!;
  }

  const [row] = await db.insert(pluginEnablement).values({ pluginId, enabled }).returning();
  return row!;
}
