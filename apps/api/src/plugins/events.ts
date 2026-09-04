import type { PluginEventBus } from '@kenresoft-cms/plugin-sdk';

// The Phase 1 implementation of PluginEventBus: an in-process, best-effort, synchronous
// module-scope singleton — not a durable queue. Handlers run synchronously within the same
// request that called emit(); nothing here persists across requests or retries a failed
// handler. No critical business state transition may depend solely on a handler firing —
// see docs/PLUGINS.md and apps/api/src/lib/webhooks.ts (DB-backed, retried on the existing
// Cron Trigger) for the durable-delivery mechanism to reach for instead, if one is ever needed.
const handlers = new Map<string, Set<(payload: unknown) => void>>();

export const pluginEventBus: PluginEventBus = {
  emit(event, payload) {
    for (const handler of handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        // A subscriber's own bug must never break the request that emitted the event.
        console.error(`Plugin event handler for "${event}" threw:`, error);
      }
    }
  },
  on(event, handler) {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  },
};
