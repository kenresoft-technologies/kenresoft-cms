import { and, desc, eq, pluginCommerceProducts } from '@kenresoft-cms/database';
import type { Database, NewPluginCommerceProduct, PluginCommerceProduct } from '@kenresoft-cms/database';

type ProductWritable = Pick<
  NewPluginCommerceProduct,
  | 'name'
  | 'slug'
  | 'description'
  | 'shortDescription'
  | 'status'
  | 'productType'
  | 'basePrice'
  | 'currency'
  | 'sku'
  | 'categoryId'
  | 'metadata'
>;

// `exactOptionalPropertyTypes` (this repo's root tsconfig) distinguishes "key absent" from "key
// present with an explicit undefined value" — callers building this object from already-optional
// query-string/zod-parsed values (e.g. `{ status, categoryId }` shorthand) need the value type to
// literally include `| undefined`, not just the key being optional via `?:`.
export interface ProductFilters {
  status?: PluginCommerceProduct['status'] | undefined;
  categoryId?: string | undefined;
}

export function listProducts(db: Database, filters: ProductFilters = {}): Promise<PluginCommerceProduct[]> {
  const conditions = [];
  if (filters.status) conditions.push(eq(pluginCommerceProducts.status, filters.status));
  if (filters.categoryId) conditions.push(eq(pluginCommerceProducts.categoryId, filters.categoryId));

  return db.query.pluginCommerceProducts.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: desc(pluginCommerceProducts.createdAt),
  });
}

export function getProductById(db: Database, id: string): Promise<PluginCommerceProduct | undefined> {
  return db.query.pluginCommerceProducts.findFirst({ where: eq(pluginCommerceProducts.id, id) });
}

// A draft 404s exactly like a nonexistent slug on the public API (Core's own
// getPublishedEntryBySlug convention) — this query filters at the source rather than fetching
// by slug and checking status afterward, so there's no path that ever distinguishes the two.
export function getPublishedProductBySlug(db: Database, slug: string): Promise<PluginCommerceProduct | undefined> {
  return db.query.pluginCommerceProducts.findFirst({
    where: and(eq(pluginCommerceProducts.slug, slug), eq(pluginCommerceProducts.status, 'published')),
  });
}

export async function createProduct(db: Database, input: ProductWritable): Promise<PluginCommerceProduct> {
  const [row] = await db.insert(pluginCommerceProducts).values(input).returning();
  return row!;
}

// Same exactOptionalPropertyTypes reasoning as ProductFilters above — a plain `Partial<T>`
// doesn't add `| undefined` to each field's value type, only to its presence, so it rejects the
// object a zod `.partial()`-derived route input actually produces.
type ProductPatch = { [K in keyof ProductWritable]?: ProductWritable[K] | undefined };

export async function updateProduct(
  db: Database,
  id: string,
  input: ProductPatch,
): Promise<PluginCommerceProduct | undefined> {
  const [row] = await db
    .update(pluginCommerceProducts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(pluginCommerceProducts.id, id))
    .returning();
  return row;
}

export async function deleteProduct(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pluginCommerceProducts)
    .where(eq(pluginCommerceProducts.id, id))
    .returning({ id: pluginCommerceProducts.id });
  return Boolean(deleted);
}
