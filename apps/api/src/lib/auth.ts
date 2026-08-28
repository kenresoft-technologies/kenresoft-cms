import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from '@kenresoft/database';

import { authOptions } from './auth-options';
import type { Bindings } from './env';

export function createAuth(env: Bindings) {
  const db = createDb(env.DB);

  return betterAuth({
    ...authOptions,
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Same allow-list the CORS middleware enforces (§9) — cross-origin cookie auth from the
    // admin SPA needs better-auth's own origin check to agree with it.
    trustedOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseHooks: {
      user: {
        create: {
          // Bootstraps the very first signup as admin — the Add User admin flow (§10) covers
          // everyone after, so without this an admin could only ever be created by hand-editing
          // the database.
          before: async () => {
            const existing = await db.query.user.findFirst({ columns: { id: true } });
            if (!existing) {
              return { data: { role: 'admin' } };
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
