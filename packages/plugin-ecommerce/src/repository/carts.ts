import {
  eq,
  and,
  isNull,
  inArray,
  pluginCommerceCarts,
  pluginCommerceCartItems,
  pluginCommerceProductVariants,
} from '@kenresoft-cms/database';
import type { Database, PluginCommerceCart } from '@kenresoft-cms/database';

export function getGuestCart(db: Database, cartId: string): Promise<PluginCommerceCart | undefined> {
  return db.query.pluginCommerceCarts.findFirst({
    where: and(eq(pluginCommerceCarts.id, cartId), isNull(pluginCommerceCarts.customerId)),
  });
}

export function getCustomerCart(db: Database, customerId: string): Promise<PluginCommerceCart | undefined> {
  return db.query.pluginCommerceCarts.findFirst({ where: eq(pluginCommerceCarts.customerId, customerId) });
}

export async function createGuestCart(db: Database, currency: string): Promise<PluginCommerceCart> {
  const [row] = await db.insert(pluginCommerceCarts).values({ currency }).returning();
  return row!;
}

export async function getOrCreateCartForCustomer(
  db: Database,
  customerId: string,
  defaultCurrency: string,
): Promise<PluginCommerceCart> {
  const existing = await getCustomerCart(db, customerId);
  if (existing) return existing;
  const [row] = await db.insert(pluginCommerceCarts).values({ customerId, currency: defaultCurrency }).returning();
  return row!;
}

// On login/register, any existing guest cart is merged into the now-authenticated customer's own
// cart: a line already present in both is summed (capped at the variant's current tracked stock,
// if any — cart-time stock capping is advisory only, not a reservation, see docs/PLUGINS.md), a
// line only in the guest cart is moved over as-is (also capped). The whole merge — creating the
// customer cart if it didn't exist, every item write, and deleting the now-emptied guest cart
// (which cascades to delete its own items) — is one db.batch() call, the same atomic-multi-write
// idiom routes/admin/security.ts's ownership-transfer fix already established in this codebase,
// so a partial merge can never leave inconsistent state.
export async function mergeGuestCartIntoCustomerCart(
  db: Database,
  guestCartId: string,
  customerId: string,
  defaultCurrency: string,
): Promise<void> {
  // Independently re-verifies this is actually a still-existing guest cart (customerId IS NULL)
  // rather than trusting the caller-supplied id — the guest-cart cookie is itself the only proof
  // of ownership (docs/PLUGINS.md's guest-cart-security note), so a forged or guessed cookie value
  // naming a DIFFERENT customer's real cart must not be honored here. Without this check, this
  // function would happily delete that other cart and move its items onto the logging-in
  // customer's own cart — a cart-hijack vector, not merely a correctness bug.
  const guestCart = await getGuestCart(db, guestCartId);
  if (!guestCart) return;

  const guestItems = await db.query.pluginCommerceCartItems.findMany({
    where: eq(pluginCommerceCartItems.cartId, guestCartId),
  });

  if (guestItems.length === 0) {
    await db.delete(pluginCommerceCarts).where(eq(pluginCommerceCarts.id, guestCartId));
    return;
  }

  const customerCart = await getCustomerCart(db, customerId);
  const customerCartId = customerCart?.id ?? crypto.randomUUID();

  const existingCustomerItems = customerCart
    ? await db.query.pluginCommerceCartItems.findMany({ where: eq(pluginCommerceCartItems.cartId, customerCart.id) })
    : [];

  const variantIds = guestItems.map((item) => item.variantId).filter((id): id is string => id !== null);
  const variants =
    variantIds.length > 0
      ? await db.query.pluginCommerceProductVariants.findMany({
          where: inArray(pluginCommerceProductVariants.id, variantIds),
        })
      : [];
  const stockByVariantId = new Map(variants.map((variant) => [variant.id, variant.stockQty]));

  type BatchStatement = Parameters<Database['batch']>[0][number];
  const statements: BatchStatement[] = [];

  if (!customerCart) {
    statements.push(db.insert(pluginCommerceCarts).values({ id: customerCartId, customerId, currency: defaultCurrency }));
  }

  for (const guestItem of guestItems) {
    const existing = existingCustomerItems.find(
      (item) => item.productId === guestItem.productId && item.variantId === guestItem.variantId,
    );
    const cap = guestItem.variantId ? stockByVariantId.get(guestItem.variantId) : undefined;

    // Out of stock — drop this guest line during merge instead of writing a nonsensical
    // quantity-0 row. A pre-existing customer-cart line for the same variant (added back when it
    // still had stock) is left untouched rather than zeroed out by an unrelated login.
    if (cap === 0) continue;

    if (existing) {
      const quantity = cap !== undefined ? Math.min(existing.quantity + guestItem.quantity, cap) : existing.quantity + guestItem.quantity;
      statements.push(
        db.update(pluginCommerceCartItems).set({ quantity, updatedAt: new Date() }).where(eq(pluginCommerceCartItems.id, existing.id)),
      );
    } else {
      const quantity = cap !== undefined ? Math.min(guestItem.quantity, cap) : guestItem.quantity;
      statements.push(
        db.insert(pluginCommerceCartItems).values({
          cartId: customerCartId,
          productId: guestItem.productId,
          variantId: guestItem.variantId,
          quantity,
        }),
      );
    }
  }

  statements.push(db.delete(pluginCommerceCarts).where(eq(pluginCommerceCarts.id, guestCartId)));

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}

export async function clearCart(db: Database, cartId: string): Promise<void> {
  await db.delete(pluginCommerceCarts).where(eq(pluginCommerceCarts.id, cartId));
}
