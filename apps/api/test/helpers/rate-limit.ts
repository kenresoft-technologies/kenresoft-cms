// Workers rate-limit bindings count in fixed windows aligned to the wall clock (Miniflare buckets
// by Math.floor(Date.now() / period)). A test that sends limit + 1 requests and expects the last
// one rejected fails whenever the run happens to cross a window boundary, because the count
// resets. Call this right before the burst: if too little of the current window is left, it waits
// for the next one to start.
export async function startInFreshRateLimitWindow(periodSeconds = 60, neededMs = 10_000): Promise<void> {
  const periodMs = periodSeconds * 1000;
  const remaining = periodMs - (Date.now() % periodMs);
  if (remaining < neededMs) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 50));
  }
}
