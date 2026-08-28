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
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Tests must be hermetic — never depend on the gitignored, developer-local
              // .dev.vars (absent in CI and on a fresh clone). This value is test-only and
              // never used outside the vitest-pool-workers runtime.
              BETTER_AUTH_SECRET: 'test-only-secret-not-used-outside-vitest-pool-workers',
            },
            // Overrides wrangler.toml's real 10/60s AUTH_RATE_LIMITER — several test files
            // sign up 10+ users each (admin-routes.test.ts, forms-routes.test.ts) inside a
            // single fast test run, which would otherwise trip the production limit and
            // produce spurious 429s unrelated to what each test is actually checking. The
            // FORM_SUBMISSION_RATE_LIMITER's real 5/60s value is intentionally NOT overridden
            // — forms-routes.test.ts has a dedicated test asserting its 429 behavior.
            ratelimits: {
              AUTH_RATE_LIMITER: { simple: { limit: 1000, period: 60 } },
            },
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
