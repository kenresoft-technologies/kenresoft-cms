import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';

import { authOptions } from './src/lib/auth-options';

// CLI-only entrypoint for `better-auth generate` — it needs a statically importable config
// to introspect the schema shape. Schema generation never executes SQL, so a stub D1Database
// is sufficient here. Real requests build auth via createAuth() in src/lib/auth.ts against
// the live Cloudflare binding instead.
const db = drizzle({} as D1Database);

export const auth = betterAuth({
  ...authOptions,
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  secret: 'cli-schema-generation-only',
  baseURL: 'http://localhost:8787',
});
