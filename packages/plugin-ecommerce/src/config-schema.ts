import { z } from 'zod';

// Non-secret, per-deployment plugin config (packages/database's plugin_settings table via
// PluginConfigService). Deliberately minimal for Phase 2a — no checkout/payment-provider
// settings yet, those belong to a later pass once checkout/payments actually exist.
export const commerceConfigSchema = z.object({
  storeName: z.string().min(1).default('My Store'),
  defaultCurrency: z.string().length(3).default('NGN'),
});

export type CommerceConfig = z.infer<typeof commerceConfigSchema>;
