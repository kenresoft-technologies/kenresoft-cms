import { desc, pluginHelloGreetings } from '@kenresoft-cms/database';
import type { Database, NewPluginHelloGreeting, PluginHelloGreeting } from '@kenresoft-cms/database';

// The only file in this plugin that ever queries plugin_hello_greetings — the Phase 1
// migration-ownership convention (docs/PLUGINS.md) is enforced by this being the sole call
// site, not by anything mechanical.
export function listGreetings(db: Database): Promise<PluginHelloGreeting[]> {
  return db.query.pluginHelloGreetings.findMany({ orderBy: desc(pluginHelloGreetings.createdAt) });
}

export async function createGreeting(
  db: Database,
  message: NewPluginHelloGreeting['message'],
): Promise<PluginHelloGreeting> {
  const [row] = await db.insert(pluginHelloGreetings).values({ message }).returning();
  return row!;
}
