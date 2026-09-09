import { eq, structuredSettings } from '@kenresoft-cms/database';
import type { Database, StructuredSettingsRow } from '@kenresoft-cms/database';
import type { StructuredSettingsModule } from '@kenresoft-cms/contracts';

export function getStructuredSettings(
  db: Database,
  module: StructuredSettingsModule,
): Promise<StructuredSettingsRow | undefined> {
  return db.query.structuredSettings.findFirst({ where: eq(structuredSettings.module, module) });
}

export function listStructuredSettings(db: Database): Promise<StructuredSettingsRow[]> {
  return db.query.structuredSettings.findMany();
}

// Structured Settings is one singleton row per module (docs/ARCHITECTURE.md §6) — enforced
// here at the API layer, same "update if present, else insert" pattern as
// repositories/settings.ts's own upsertSettings().
export async function upsertStructuredSettings(
  db: Database,
  module: StructuredSettingsModule,
  data: Record<string, unknown>,
): Promise<StructuredSettingsRow> {
  const existing = await getStructuredSettings(db, module);

  if (existing) {
    const [row] = await db
      .update(structuredSettings)
      .set({ data, updatedAt: new Date() })
      .where(eq(structuredSettings.id, existing.id))
      .returning();
    return row!;
  }

  const [row] = await db.insert(structuredSettings).values({ module, data }).returning();
  return row!;
}
