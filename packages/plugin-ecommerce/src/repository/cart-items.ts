import { eq, and, isNull, inArray, pluginCommerceCartItems, pluginCommerceProducts, pluginCommerceProductVariants } from '@kenresoft-cms/database';
import type { Database, PluginCommerceCartItem, PluginCommerceProduct, PluginCommerceProductVariant } from '@kenresoft-cms/database';

export interface CartItemWithDetail {
  item: PluginCommerceCartItem;
  product: PluginCommerceProduct;
  variant: PluginCommerceProductVariant | null;
}

// Cart items never store a price or name snapshot — both are always read live from the product/
// variant here. Snapshotting at time-of-add belongs to Order (2c), which is a durable financial
// record; a cart is ephemeral, pre-purchase state (docs/PLUGINS.md's Commerce section).
export async function listItemsWithDetail(db: Database, cartId: string): Promise<CartItemWithDetail[]> {
  const items = await db.query.pluginCommerceCartItems.findMany({ where: eq(pluginCommerceCartItems.cartId, cartId) });
  if (items.length === 0) return [];

  const productIds = [...new Set(items.map((item) => item.productId))];
  const variantIds = [...new Set(items.map((item) => item.variantId).filter((id): id is string => id !== null))];

  const [products, variants] = await Promise.all([
    db.query.pluginCommerceProducts.findMany({ where: inArray(pluginCommerceProducts.id, productIds) }),
    variantIds.length > 0
      ? db.query.pluginCommerceProductVariants.findMany({ where: inArray(pluginCommerceProductVariants.id, variantIds) })
      : Promise.resolve([]),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  return items
    .map((item) => {
      const product = productById.get(item.productId);
      if (!product) return null; // Shouldn't happen (FK cascade removes the item too) — defensive only.
      return { item, product, variant: item.variantId ? (variantById.get(item.variantId) ?? null) : null };
    })
    .filter((entry): entry is CartItemWithDetail => entry !== null);
}

function stockCap(variant: PluginCommerceProductVariant | null | undefined): number | undefined {
  return variant ? variant.stockQty : undefined;
}

// Looks up an existing row for (cartId, productId, variantId) by hand before deciding
// insert-vs-update — SQLite unique indexes don't collapse `variantId IS NULL` rows the way this
// needs, so this is deliberate application logic (matching the entries-export-import
// upsert-by-slug precedent), not a DB constraint. The stock cap here is advisory UX only, never
// a reservation — see docs/PLUGINS.md.
export async function addOrIncrementItem(
  db: Database,
  cartId: string,
  input: { productId: string; variantId: string | null; quantity: number },
): Promise<PluginCommerceCartItem> {
  const variant = input.variantId
    ? await db.query.pluginCommerceProductVariants.findFirst({ where: eq(pluginCommerceProductVariants.id, input.variantId) })
    : null;
  const cap = stockCap(variant);

  // The no-variant branch must explicitly require variantId IS NULL — without it, a product
  // that already has a *different* variant row in this cart would wrongly match here too, since
  // cartId+productId alone doesn't distinguish "no variant" from "some other variant".
  const existing = await db.query.pluginCommerceCartItems.findFirst({
    where: input.variantId
      ? and(
          eq(pluginCommerceCartItems.cartId, cartId),
          eq(pluginCommerceCartItems.productId, input.productId),
          eq(pluginCommerceCartItems.variantId, input.variantId),
        )
      : and(
          eq(pluginCommerceCartItems.cartId, cartId),
          eq(pluginCommerceCartItems.productId, input.productId),
          isNull(pluginCommerceCartItems.variantId),
        ),
  });

  if (existing) {
    const quantity = cap !== undefined ? Math.min(existing.quantity + input.quantity, cap) : existing.quantity + input.quantity;
    const [row] = await db
      .update(pluginCommerceCartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(pluginCommerceCartItems.id, existing.id))
      .returning();
    return row!;
  }

  const quantity = cap !== undefined ? Math.min(input.quantity, cap) : input.quantity;
  const [row] = await db
    .insert(pluginCommerceCartItems)
    .values({ cartId, productId: input.productId, variantId: input.variantId, quantity })
    .returning();
  return row!;
}

export async function updateItemQuantity(
  db: Database,
  itemId: string,
  quantity: number,
): Promise<PluginCommerceCartItem | undefined> {
  const existing = await db.query.pluginCommerceCartItems.findFirst({ where: eq(pluginCommerceCartItems.id, itemId) });
  if (!existing) return undefined;

  const variant = existing.variantId
    ? await db.query.pluginCommerceProductVariants.findFirst({ where: eq(pluginCommerceProductVariants.id, existing.variantId) })
    : null;
  const cap = stockCap(variant);
  const cappedQuantity = cap !== undefined ? Math.min(quantity, cap) : quantity;

  const [row] = await db
    .update(pluginCommerceCartItems)
    .set({ quantity: cappedQuantity, updatedAt: new Date() })
    .where(eq(pluginCommerceCartItems.id, itemId))
    .returning();
  return row;
}

export async function removeItem(db: Database, itemId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pluginCommerceCartItems)
    .where(eq(pluginCommerceCartItems.id, itemId))
    .returning({ id: pluginCommerceCartItems.id });
  return Boolean(deleted);
}
