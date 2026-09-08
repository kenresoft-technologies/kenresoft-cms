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

// Deliberately does NOT include pending -> paid. Payment settlement is authoritative and lives
// entirely outside this function: resolvePaymentAttempt (repository/payments.ts) transitions an
// order to 'paid' itself, via its own atomic conditional UPDATE driven only by a Paystack-verified
// reference/webhook — never by this admin-facing status-transition table. Before this restriction,
// PATCH /orders/{id}/status let any editor mark an order 'paid' by hand with zero payment ever
// having occurred, which is a real financial-integrity gap for a durable order record, not a minor
// inconvenience. If a genuinely unpaid order needs to be treated as fulfilled for some
// out-of-band reason (e.g. a manual bank transfer this deployment doesn't process through
// Paystack), that's a deliberately unsupported case today, not silently allowed through this API.
//
// 'refunded' deliberately has NO transition reaching it either — it stays a defined status value
// (so a future pass can implement real provider-backed refunds without a schema/type migration)
// but is unreachable through this API today. Before this restriction, paid/fulfilled -> refunded
// changed the CMS status and restocked inventory WITHOUT ever calling Paystack's refund API — an
// order could read "refunded" while no money had actually moved back to the customer, which is
// worse than not offering the transition at all. Re-enable it only alongside real refund handling
// (initiating and confirming an actual Paystack refund before/as part of this transition) — see
// docs/PLUGINS.md's Commerce section.
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['cancelled'],
  paid: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
  refunded: [],
};

const RESTOCKING_STATUSES: OrderStatus[] = ['cancelled'];

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
  // POST /checkout's client-supplied Idempotency-Key header, always required from that route.
  // See orders.idempotencyKey's own schema comment for why this is the actual, DB-enforced
  // correctness guarantee — the separate plugin_commerce_idempotency_keys claim/reclaim table
  // (routes/checkout.ts) is a fast-path/availability mechanism only, not sufficient on its own.
  idempotencyKey: string;
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
// this runs as two phases instead of relying on row locks:
//
// Phase 1 conditionally decrements every tracked-stock line in one batch (`WHERE stock_qty >=
// quantity`, `.returning()` so a non-match — insufficient stock — is visible per statement, not
// just "0 rows" silently ignored); if any line failed, the lines that DID succeed are given back
// in a compensating batch before returning failure, so a checkout that can't be fully satisfied
// never partially decrements stock out from under other customers.
//
// Phase 2 is a SINGLE batch that inserts the order row, every order-item row, and the cart delete
// together — closing a real gap the prior two-batch design had: with the order insert as its own
// standalone statement, a losing concurrent execution (or an admin/read path racing the write)
// could observe an order row that exists with zero items in between, and a crash between the two
// batches could leave that state permanently. Because every item-insert statement references
// THIS execution's own `orderId` via a NOT NULL foreign key, a losing execution's order insert
// (skipped by `.onConflictDoNothing()` against `idempotencyKey`'s own UNIQUE constraint, since its
// row was never actually written) makes its own item inserts violate that foreign key — a genuine
// SQL error, which aborts the whole batch under D1's own transactional batch atomicity. That
// failure is caught below and treated exactly like the previous design's "lost the race" path:
// give back the stock this execution speculatively reserved and return the WINNER's order
// (looked up by idempotencyKey) instead. A winning execution's insert succeeds, so its own item
// inserts reference a real row and the whole batch — order, every item, and the cart delete —
// commits atomically together: an order can never be observed, nor left behind after a crash,
// with no items.
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

  // A helper so both the success path and the "lost the race" catch block below give back
  // phase 1's speculative reservation the same way.
  const giveBackReservedStock = async () => {
    if (trackedItems.length === 0) return;
    const giveBackStatements: BatchStatement[] = trackedItems.map((entry) =>
      db
        .update(pluginCommerceProductVariants)
        .set({ stockQty: sql`${pluginCommerceProductVariants.stockQty} + ${entry.item.quantity}`, updatedAt: new Date() })
        .where(eq(pluginCommerceProductVariants.id, entry.variant.id)),
    );
    await db.batch(giveBackStatements as [BatchStatement, ...BatchStatement[]]);
  };

  const statements: BatchStatement[] = [
    db
      .insert(pluginCommerceOrders)
      .values({
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
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning(),
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

  let batchResults: Array<Array<PluginCommerceOrder>>;
  try {
    batchResults = (await db.batch(statements as [BatchStatement, ...BatchStatement[]])) as unknown as Array<Array<PluginCommerceOrder>>;
  } catch (err) {
    // Most likely: this execution lost the idempotency-key race (its own order insert above was
    // skipped by onConflictDoNothing, so its own item inserts referenced a nonexistent orderId
    // and violated their foreign key, aborting the whole batch — see this function's own comment).
    // Give back this execution's speculative stock reservation either way and look for the
    // winner's order by idempotencyKey.
    await giveBackReservedStock();
    const existing = await db.query.pluginCommerceOrders.findFirst({ where: eq(pluginCommerceOrders.idempotencyKey, input.idempotencyKey) });
    if (existing) {
      return { ok: true, order: existing };
    }
    // No order exists for this key after all — this was a genuinely unexpected failure, not the
    // anticipated idempotency-key conflict. Surface it rather than silently misreporting it as
    // out-of-stock.
    throw err;
  }

  const insertedOrder = batchResults[0]?.[0];
  if (!insertedOrder) {
    // Defensive: the batch committed without error (nothing else referenced this execution's
    // orderId in a way that would fail), yet the order insert itself still reported no row —
    // should be unreachable given every item insert above references orderId via a NOT NULL FK,
    // but handled the same way as the thrown-error case rather than assumed impossible.
    await giveBackReservedStock();
    const existing = await db.query.pluginCommerceOrders.findFirst({ where: eq(pluginCommerceOrders.idempotencyKey, input.idempotencyKey) });
    if (existing) {
      return { ok: true, order: existing };
    }
    return { ok: false, error: 'out_of_stock', unavailable: [] };
  }

  return { ok: true, order: insertedOrder };
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
