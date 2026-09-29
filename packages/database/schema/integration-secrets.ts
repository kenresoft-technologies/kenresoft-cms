import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Third-party API keys an admin enters from the CMS instead of `wrangler secret put` — deliberately
// narrow: low-risk, read-only, rate-limited keys (today only Pixabay's image search). Anything that
// can move money or send mail as the deployment (Paystack, Resend) stays a Worker secret. The value
// is AES-GCM encrypted (apps/api/src/lib/secret-store.ts, key derived from BETTER_AUTH_SECRET), so a
// D1 export never contains a plaintext key, and no route ever returns it.
export const integrationSecrets = sqliteTable('integration_secrets', {
  key: text('key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type IntegrationSecret = typeof integrationSecrets.$inferSelect;
