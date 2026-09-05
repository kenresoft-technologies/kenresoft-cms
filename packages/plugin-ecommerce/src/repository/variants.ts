import { asc, eq, pluginCommerceProductVariants } from '@kenresoft-cms/database';
import type { Database, NewPluginCommerceProductVariant, PluginCommerceProductVariant } from '@kenresoft-cms/database';

type VariantWritable = Pick<
  NewPluginCommerceProductVariant,
  'productId' | 'name' | 'sku' | 'price' | 'compareAtPrice' | 'stockQty' | 'status' | 'attributes'
>;

export function listVariantsForProduct(db: Database, productId: string): Promise<PluginCommerceProductVariant[]> {
  return db.query.pluginCommerceProductVariants.findMany({
    where: eq(pluginCommerceProductVariants.productId, productId),
    orderBy: asc(pluginCommerceProductVariants.createdAt),
  });
}

export function getVariantById(db: Database, id: string): Promise<PluginCommerceProductVariant | undefined> {
  return db.query.pluginCommerceProductVariants.findFirst({ where: eq(pluginCommerceProductVariants.id, id) });
}

export async function createVariant(db: Database, input: VariantWritable): Promise<PluginCommerceProductVariant> {
  const [row] = await db.insert(pluginCommerceProductVariants).values(input).returning();
  return row!;
}

// `exactOptionalPropertyTypes` (this repo's root tsconfig) needs `| undefined` on each field's
// value type, not just an optional key — a plain `Partial<Omit<...>>` doesn't produce that,
// so it rejects the object a zod `.partial()`-derived route input actually produces.
type VariantPatch = { [K in keyof Omit<VariantWritable, 'productId'>]?: VariantWritable[K] | undefined };

export async function updateVariant(
  db: Database,
  id: string,
  input: VariantPatch,
): Promise<PluginCommerceProductVariant | undefined> {
  const [row] = await db
    .update(pluginCommerceProductVariants)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(pluginCommerceProductVariants.id, id))
    .returning();
  return row;
}

export async function deleteVariant(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pluginCommerceProductVariants)
    .where(eq(pluginCommerceProductVariants.id, id))
    .returning({ id: pluginCommerceProductVariants.id });
  return Boolean(deleted);
}
