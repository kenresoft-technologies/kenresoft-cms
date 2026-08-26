import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('../../packages/database/migrations');

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
            // nodejs_compat + a compatibility_date past 2025-09-21 breaks
            // @cloudflare/vitest-pool-workers (cloudflare/workers-sdk#11028). wrangler.toml
            // keeps the real date for actual deploys; the test pool alone pins an earlier
            // one to dodge the regression — nodejs_compat itself must stay on since
            // better-auth needs node:async_hooks.
            compatibilityDate: '2025-09-20',
          },
        },
      },
    },
  };
});
