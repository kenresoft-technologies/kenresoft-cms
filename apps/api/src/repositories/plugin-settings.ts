import { eq, pluginSettings } from '@kenresoft-cms/database';
import type { Database, PluginSettingsRow } from '@kenresoft-cms/database';

export function getPluginSettingsRow(db: Database, pluginId: string): Promise<PluginSettingsRow | undefined> {
  return db.query.pluginSettings.findFirst({ where: eq(pluginSettings.pluginId, pluginId) });
}

// One row per plugin (pluginId is the primary key) — update the existing row if there is one,
// otherwise create it, matching repositories/settings.ts's exact singleton-upsert idiom.
export async function upsertPluginConfig(
  db: Database,
  pluginId: string,
  config: Record<string, unknown>,
): Promise<PluginSettingsRow> {
  const existing = await getPluginSettingsRow(db, pluginId);

  if (existing) {
    const [row] = await db
      .update(pluginSettings)
      .set({ config, updatedAt: new Date() })
      .where(eq(pluginSettings.pluginId, pluginId))
      .returning();
    return row!;
  }

  const [row] = await db.insert(pluginSettings).values({ pluginId, config }).returning();
  return row!;
}
