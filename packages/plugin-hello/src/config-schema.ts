import { z } from 'zod';

// Non-secret, per-deployment plugin config (packages/database's plugin_settings table via
// PluginConfigService) — the one thing this hello-world plugin demonstrates configuring: the
// greeting message a new POST /greetings prepends to a created message.
export const helloConfigSchema = z.object({
  greeting: z.string().min(1).default('Hello'),
});

export type HelloConfig = z.infer<typeof helloConfigSchema>;
