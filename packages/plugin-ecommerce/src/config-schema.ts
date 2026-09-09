import { z } from 'zod';

// Non-secret, per-deployment plugin config (packages/database's plugin_settings table via
// PluginConfigService). Deliberately minimal for Phase 2a — no checkout/payment-provider
// settings yet, those belong to a later pass once checkout/payments actually exist.
export const commerceConfigSchema = z.object({
  storeName: z.string().min(1).default('My Store'),
  defaultCurrency: z.string().length(3).default('NGN'),
  // The storefront's own base URL (e.g. an examples/astro-site deployment) — used only to build a
  // real, clickable link in the verify-email/password-reset emails below. Optional: unset, the
  // emails fall back to a plain instruction (this Commerce plugin has no way to know a
  // frontend's URL on its own, same reasoning as Core's settings.previewUrl).
  siteUrl: z.string().url().nullable().default(null),
});

export type CommerceConfig = z.infer<typeof commerceConfigSchema>;
