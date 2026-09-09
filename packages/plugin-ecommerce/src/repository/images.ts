import { asc, eq, pluginCommerceProductImages } from '@kenresoft-cms/database';
import type { Database, NewPluginCommerceProductImage, PluginCommerceProductImage } from '@kenresoft-cms/database';

export function listImagesForProduct(db: Database, productId: string): Promise<PluginCommerceProductImage[]> {
  return db.query.pluginCommerceProductImages.findMany({
    where: eq(pluginCommerceProductImages.productId, productId),
    orderBy: asc(pluginCommerceProductImages.sortOrder),
  });
}

export function getImageById(db: Database, id: string): Promise<PluginCommerceProductImage | undefined> {
  return db.query.pluginCommerceProductImages.findFirst({ where: eq(pluginCommerceProductImages.id, id) });
}

export async function createProductImage(
  db: Database,
  input: Pick<NewPluginCommerceProductImage, 'productId' | 'mediaId' | 'sortOrder' | 'altText'>,
): Promise<PluginCommerceProductImage> {
  const [row] = await db.insert(pluginCommerceProductImages).values(input).returning();
  return row!;
}

export async function deleteProductImage(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pluginCommerceProductImages)
    .where(eq(pluginCommerceProductImages.id, id))
    .returning({ id: pluginCommerceProductImages.id });
  return Boolean(deleted);
}
