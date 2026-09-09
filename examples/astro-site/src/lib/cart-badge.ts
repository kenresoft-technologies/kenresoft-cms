import { getBrowserClient } from './browser-client';

// Keeps the header's cart-item-count badge in sync from client-side script — the header itself
// is SSR-rendered (so it reflects real signed-in/guest state with no flash), but the cart's own
// item count is refreshed here after every add/update/remove so a shopper never sees a stale
// count without a full page reload. Safe to call on any page; a fetch failure just leaves
// whatever count was last rendered.
export async function refreshCartBadge(): Promise<void> {
  const badge = document.querySelector<HTMLElement>('[data-cart-count]');
  if (!badge) return;
  try {
    const cart = await getBrowserClient().commerce.cart.get();
    const count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    badge.textContent = String(count);
    badge.hidden = count === 0;
  } catch {
    // Leave the badge as SSR-rendered it — a transient failure here isn't worth surfacing.
  }
}
