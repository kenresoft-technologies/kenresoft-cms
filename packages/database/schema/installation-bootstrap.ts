import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// A singleton row (id fixed to "singleton") tracking this deployment's one-time first-owner
// bootstrap. Never a hardcoded credential: `tokenHash` is a SHA-256 hash of a randomly
// generated token that's never persisted or transmitted in plaintext, except once — logged
// server-side only (visible via `wrangler tail`/`wrangler dev` output), the same "operator
// reads it from their own logs" convention already established for the noop email sender. See
// apps/api/src/routes/system/bootstrap-owner.ts for the request/complete flow this backs.
export const installationBootstrap = sqliteTable("installation_bootstrap", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});
