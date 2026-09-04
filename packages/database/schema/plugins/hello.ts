import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Owned by packages/plugin-hello (docs/PLUGINS.md) — the Phase 1 plugin-platform proof table.
// Lives here, not inside packages/plugin-hello itself, because drizzle-kit generate only reads
// this package's schema/index.ts; "ownership" is enforced by the `plugin_hello_` table-name
// prefix and by convention (only packages/plugin-hello/src/repository.ts ever queries this
// table), not by a physically separate migration history or D1 database — see docs/PLUGINS.md's
// migration-composition note for the full reasoning.
export const pluginHelloGreetings = sqliteTable(
  'plugin_hello_greetings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    message: text('message').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('plugin_hello_greetings_created_at_idx').on(table.createdAt)],
);

export type PluginHelloGreeting = typeof pluginHelloGreetings.$inferSelect;
export type NewPluginHelloGreeting = typeof pluginHelloGreetings.$inferInsert;
