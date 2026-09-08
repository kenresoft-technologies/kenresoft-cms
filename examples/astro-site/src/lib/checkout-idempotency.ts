// The backend enforces checkout idempotency with a real DB constraint (CLAUDE.md's Commerce
// Phase 2d round-2 entry: a UNIQUE idempotencyKey on the orders table) — a client that mints a
// fresh key on every submit attempt gets no benefit from that at all, and a client that reuses
// one key forever across genuinely different carts would get the FIRST order replayed back for
// every later purchase, which is just as wrong. The key must be minted exactly once per checkout
// ATTEMPT (this page load) and reused across retries of that same attempt (a network failure, a
// double-click, the user re-submitting after fixing a validation error) — never regenerated
// until the user deliberately starts a fresh one (a full page reload of /checkout, which this
// module treats as a new attempt by design: sessionStorage is cleared on navigating away and
// back only if the tab is closed, but a plain reload of THIS SAME page must NOT mint a new key,
// so this is read once at module-eval time and never touched again while the page is open).
const KEY = 'kenresoft:checkout-idempotency-key';

export function getOrCreateIdempotencyKey(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // No sessionStorage available — fall back to a key that's at least stable for this page's
    // lifetime (module-level singleton), so retries within the same load still dedupe correctly.
    return moduleFallbackKey ??= crypto.randomUUID();
  }
}

let moduleFallbackKey: string | undefined;

/** Called only after a checkout attempt genuinely completes (success or a final, non-retryable failure) — clears the key so the next visit to /checkout starts a fresh attempt. */
export function clearIdempotencyKey(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  moduleFallbackKey = undefined;
}
