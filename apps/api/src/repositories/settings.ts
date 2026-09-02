import { eq, settings } from '@kenresoft-cms/database';
import type { Database, NewSettings, Settings } from '@kenresoft-cms/database';

export function getSettings(db: Database): Promise<Settings | undefined> {
  return db.query.settings.findFirst();
}

// Settings is a singleton (§6, §11) — enforced here, at the API layer, rather than by a DB
// constraint: update the one existing row if there is one, otherwise create it.
export async function upsertSettings(
  db: Database,
  input: Pick<NewSettings, 'name' | 'contactEmail' | 'socialLinks' | 'corsOrigin' | 'featureFlags'>,
): Promise<Settings> {
  const existing = await getSettings(db);

  if (existing) {
    const [row] = await db
      .update(settings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(settings.id, existing.id))
      .returning();
    return row!;
  }

  const [row] = await db.insert(settings).values(input).returning();
  return row!;
}
