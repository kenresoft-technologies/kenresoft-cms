import {
  and,
  asc,
  desc,
  eq,
  gte,
  sql,
  pluginCommerceCarts,
  pluginCommerceOrderItems,
  pluginCommerceOrders,
  pluginCommerceProductVariants,
} from '@kenresoft-cms/database';
import type { Database, PluginCommerceOrder, PluginCommerceOrderItem } from '@kenresoft-cms/database';

import type { CartItemWithDetail } from './cart-items';

export type OrderStatus = PluginCommerceOrder['status'];

// pending -> paid is Phase 2d's job (a real payment gateway); everything else is manageable by an
// admin today. cancelled/refunded are both terminal and both restock (see RESTOCKING_STATUSES) —
// modeling "an order was fulfilled, then returned" as a second, separate refund-after-fulfillment
// path rather than folding it into cancellation.
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'cancelled', 'refunded'],
  fulfilled: ['refunded'],
  cancelled: [],
  refunded: [],
};

const RESTOCKING_STATUSES: OrderStatus[] = ['cancelled', 'refunded'];

// `exactOptionalPropertyTypes` (this repo's root tsconfig) needs `| undefined` explicitly on each
// optional field's value type, not just the key being optional — matching the VariantPatch/
// AddressPatch precedent elsewhere in this package — so this accepts a zod-parsed
// `.optional().nullable()` field's real inferred shape directly.
export interface ShippingAddressInput {
  recipientName: string;
  line1: string;
  line2?: string | null | undefined;
  city: string;
  region?: string | null | undefined;
  postalCode: string;
  country: string;
  phone?: string | null | undefined;
}

export interface CreateOrderInput {
  cartId: string;
  customerId: string | null;
  customerEmail: string;
  customerName: string;
  currency: string;
  shippingAddress: ShippingAddressInput;
  items: CartItemWithDetail[];
}

export type CreateOrderResult =
  | { ok: true; order: PluginCommerceOrder }
  | {
      ok: false;
      error: 'out_of_stock';
      unavailable: Array<{ productId: string; variantId: string; productName: string }>;
    };

type BatchStatement = Parameters<Database['batch']>[0][number];

// Real, concurrency-safe stock enforcement — the "advisory only" capping in cart-items.ts/carts.ts
// is deliberately just UX; this is the actual reservation. D1 has no SELECT ... FOR UPDATE, so
// this runs as two phases instead of relying on row locks: phase one conditionally decrements
// every tracked-stock line in one batch (`WHERE stock_qty >= quantity`, `.returning()` so a
// non-match — insufficient stock — is visible per statement, not just "0 rows" silently ignored);
// if any line failed, the lines that DID succeed are given back in a compensating batch before
// returning failure, so a checkout that can't be fully satisfied never partially decrements stock
// out from under other customers. D1's own batch atomicity (all-or-nothing on a genuine SQL
// error) is necessary but not sufficient here, since a WHERE clause matching zero rows is not a
// SQL error — hence the explicit two-phase reserve-then-compensate design rather than leaning on
// batch rollback alone. Known, accepted gap: a crash between the reservation batch and the
// order-creation batch below would leave stock decremented with no order to show for it — D1 has
// no cross-request saga/compensation log, and adding one is out of scope for this pass.
export async function createOrder(db: Database, input: CreateOrderInput): Promise<CreateOrderResult> {
  const trackedItems = input.items.filter(
    (entry): entry is CartItemWithDetail & { variant: NonNullable<CartItemWithDetail['variant']> } => entry.variant !== null,
  );

  if (trackedItems.length > 0) {
    const decrementStatements: BatchStatement[] = trackedItems.map((entry) =>
      db
        .update(pluginCommerceProductVariants)
        .set({ stockQty: sql`${pluginCommerceProductVariants.stockQty} - ${entry.item.quantity}`, updatedAt: new Date() })
        .where(and(eq(pluginCommerceProductVariants.id, entry.variant.id), gte(pluginCommerceProductVariants.stockQty, entry.item.quantity)))
        .returning({ id: pluginCommerceProductVariants.id }),
    );
    const decrementResults = (await db.batch(
      decrementStatements as [BatchStatement, ...BatchStatement[]],
    )) as unknown as Array<Array<{ id: string }>>;

    const unavailable: Array<{ productId: string; variantId: string; productName: string }> = [];
    const succeeded: typeof trackedItems = [];
    trackedItems.forEach((entry, index) => {
      if (decrementResults[index]!.length === 0) {
        unavailable.push({ productId: entry.product.id, variantId: entry.variant.id, productName: entry.product.name });
      } else {
        succeeded.push(entry);
      }
    });

    if (unavailable.length > 0) {
      if (succeeded.length > 0) {
        const compensationStatements: BatchStatement[] = succeeded.map((entry) =>
          db
            .update(pluginCommerceProductVariants)
            .set({ stockQty: sql`${pluginCommerceProductVariants.stockQty} + ${entry.item.quantity}`, updatedAt: new Date() })
            .where(eq(pluginCommerceProductVariants.id, entry.variant.id)),
        );
        await db.batch(compensationStatements as [BatchStatement, ...BatchStatement[]]);
      }
      return { ok: false, error: 'out_of_stock', unavailable };
    }
  }

  const orderId = crypto.randomUUID();
  const totalAmount = input.items.reduce(
    (sum, entry) => sum + (entry.variant?.price ?? entry.product.basePrice) * entry.item.quantity,
    0,
  );

  const statements: BatchStatement[] = [
    db.insert(pluginCommerceOrders).values({
      id: orderId,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      currency: input.currency,
      totalAmount,
      shippingAddress: {
        recipientName: input.shippingAddress.recipientName,
        line1: input.shippingAddress.line1,
        line2: input.shippingAddress.line2 ?? null,
        city: input.shippingAddress.city,
        region: input.shippingAddress.region ?? null,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
        phone: input.shippingAddress.phone ?? null,
      },
    }),
    ...input.items.map((entry) =>
      db.insert(pluginCommerceOrderItems).values({
        orderId,
        productId: entry.product.id,
        variantId: entry.variant?.id ?? null,
        productName: entry.product.name,
        variantName: entry.variant?.name ?? null,
        sku: entry.variant?.sku ?? entry.product.sku ?? null,
        unitPriceAtPurchase: entry.variant?.price ?? entry.product.basePrice,
        quantity: entry.item.quantity,
      }),
    ),
    // Relies on cart_items' own onDelete: 'cascade' FK to plugin_commerce_carts — the same
    // single-delete pattern repository/carts.ts's clearCart already uses.
    db.delete(pluginCommerceCarts).where(eq(pluginCommerceCarts.id, input.cartId)),
  ];

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

  const order = await db.query.pluginCommerceOrders.findFirst({ where: eq(pluginCommerceOrders.id, orderId) });
  return { ok: true, order: order! };
}

export interface OrderFilters {
  status?: OrderStatus | undefined;
}

export function listOrders(db: Database, filters: OrderFilters = {}): Promise<PluginCommerceOrder[]> {
  return db.query.pluginCommerceOrders.findMany({
    where: filters.status ? eq(pluginCommerceOrders.status, filters.status) : undefined,
    orderBy: desc(pluginCommerceOrders.createdAt),
  });
}

export function listOrdersForCustomer(db: Database, customerId: string): Promise<PluginCommerceOrder[]> {
  return db.query.pluginCommerceOrders.findMany({
    where: eq(pluginCommerceOrders.customerId, customerId),
    orderBy: desc(pluginCommerceOrders.createdAt),
  });
}

export function getOrderById(db: Database, id: string): Promise<PluginCommerceOrder | undefined> {
  return db.query.pluginCommerceOrders.findFirst({ where: eq(pluginCommerceOrders.id, id) });
}

export function listOrderItems(db: Database, orderId: string): Promise<PluginCommerceOrderItem[]> {
  return db.query.pluginCommerceOrderItems.findMany({
    where: eq(pluginCommerceOrderItems.orderId, orderId),
    orderBy: asc(pluginCommerceOrderItems.createdAt),
  });
}

export type UpdateOrderStatusResult =
  | { ok: true; order: PluginCommerceOrder }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'invalid_transition' };

// Restocking on cancel/refund is the inventory-correctness half of real stock enforcement — a
// cancelled order's reserved units must come back, or every cancellation permanently shrinks
// available stock. A line whose variant has since been deleted (variantId already null via the
// FK's own set-null) is simply skipped: there's nothing left to restock.
export async function updateOrderStatus(db: Database, orderId: string, nextStatus: OrderStatus): Promise<UpdateOrderStatusResult> {
  const order = await getOrderById(db, orderId);
  if (!order) return { ok: false, error: 'not_found' };

  if (!VALID_TRANSITIONS[order.status].includes(nextStatus)) {
    return { ok: false, error: 'invalid_transition' };
  }

  const statements: BatchStatement[] = [
    db.update(pluginCommerceOrders).set({ status: nextStatus, updatedAt: new Date() }).where(eq(pluginCommerceOrders.id, orderId)),
  ];

  if (RESTOCKING_STATUSES.includes(nextStatus)) {
    const items = await listOrderItems(db, orderId);
    for (const item of items) {
      if (!item.variantId) continue;
      statements.push(
        db
          .update(pluginCommerceProductVariants)
          .set({ stockQty: sql`${pluginCommerceProductVariants.stockQty} + ${item.quantity}`, updatedAt: new Date() })
          .where(eq(pluginCommerceProductVariants.id, item.variantId)),
      );
    }
  }

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  const updated = await getOrderById(db, orderId);
  return { ok: true, order: updated! };
}
