import { asc, eq, pluginCommerceCategories } from '@kenresoft-cms/database';
import type { Database, NewPluginCommerceCategory, PluginCommerceCategory } from '@kenresoft-cms/database';

type CategoryWritable = Pick<
  NewPluginCommerceCategory,
  'name' | 'slug' | 'description' | 'parentId' | 'imageId' | 'status' | 'sortOrder'
>;

// `exactOptionalPropertyTypes` (this repo's root tsconfig) needs `| undefined` on the value
// type, not just an optional key, for callers building this from an already-optional value.
export interface CategoryFilters {
  status?: PluginCommerceCategory['status'] | undefined;
}

export function listCategories(db: Database, filters: CategoryFilters = {}): Promise<PluginCommerceCategory[]> {
  return db.query.pluginCommerceCategories.findMany({
    where: filters.status ? eq(pluginCommerceCategories.status, filters.status) : undefined,
    orderBy: asc(pluginCommerceCategories.sortOrder),
  });
}

export function getCategoryById(db: Database, id: string): Promise<PluginCommerceCategory | undefined> {
  return db.query.pluginCommerceCategories.findFirst({ where: eq(pluginCommerceCategories.id, id) });
}

export async function createCategory(db: Database, input: CategoryWritable): Promise<PluginCommerceCategory> {
  const [row] = await db.insert(pluginCommerceCategories).values(input).returning();
  return row!;
}

// `exactOptionalPropertyTypes` needs `| undefined` on each field's value type, not just an
// optional key — a plain `Partial<T>` doesn't produce that.
type CategoryPatch = { [K in keyof CategoryWritable]?: CategoryWritable[K] | undefined };

export async function updateCategory(
  db: Database,
  id: string,
  input: CategoryPatch,
): Promise<PluginCommerceCategory | undefined> {
  const [row] = await db
    .update(pluginCommerceCategories)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(pluginCommerceCategories.id, id))
    .returning();
  return row;
}

export async function deleteCategory(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pluginCommerceCategories)
    .where(eq(pluginCommerceCategories.id, id))
    .returning({ id: pluginCommerceCategories.id });
  return Boolean(deleted);
}
