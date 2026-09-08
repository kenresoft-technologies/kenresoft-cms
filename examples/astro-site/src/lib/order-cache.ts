import type { CommerceOrder } from '@kenresoft-cms/astro';

// A real, honestly-flagged gap this rebuild found: there is no public "get order by id" route
// for a GUEST (only GET /customer/orders/:id, which requires a signed-in customer session — see
// packages/plugin-ecommerce/src/routes/customer.ts). checkout.ts's own POST /checkout response
// is the only place a guest's full order (with line items) is ever returned. This sessionStorage
// cache is what lets /order/[id] still show a real confirmation for a guest who just checked out
// in this same browser tab, without inventing a fake endpoint or silently pretending the gap
// doesn't exist — see this example's README for the full explanation, repeated on /order/[id]
// itself for a guest who lands there with nothing cached (e.g. a bookmarked link, a different
// browser, or an already-cleared session storage).
const KEY_PREFIX = 'kenresoft:last-order:';

export function cacheOrder(order: CommerceOrder): void {
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${order.id}`, JSON.stringify(order));
  } catch {
    // sessionStorage can throw in a locked-down browser context — the cache is a convenience,
    // never required for correctness (the payment verify call is still server-authoritative).
  }
}

export function getCachedOrder(orderId: string): CommerceOrder | null {
  try {
    const raw = sessionStorage.getItem(`${KEY_PREFIX}${orderId}`);
    return raw ? (JSON.parse(raw) as CommerceOrder) : null;
  } catch {
    return null;
  }
}
