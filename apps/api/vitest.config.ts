import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// package.json pins vitest to ^3.2.4 here, deliberately behind apps/admin's ^4.x — not an
// oversight to "fix" by bumping it. @cloudflare/vitest-pool-workers@0.9.14's peerDependencies
// cap vitest/@vitest/runner/@vitest/snapshot at the 3.2.x line; a bump here would break every
// test in this package until the pool package itself ships v4 support. Re-check this pin
// whenever @cloudflare/vitest-pool-workers is upgraded.

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
              // Set here (unlike production, where it's absent by default) so
              // owner-recovery-endpoint.test.ts can exercise the "configured" path via a real
              // SELF.fetch — mutating cloudflare:test's `env.OWNER_RECOVERY_SECRET` at runtime
              // doesn't propagate to the Worker a SELF.fetch actually dispatches to (confirmed
              // empirically: plain string vars are baked in at Miniflare startup, unlike D1/R2
              // bindings, which are live references). The "unset → 404" case is instead tested
              // directly against the route with a bare Bindings object with no property at all
              // (test/owner-recovery-endpoint.test.ts's "not configured" describe block).
              OWNER_RECOVERY_SECRET: 'test-only-owner-recovery-secret-not-used-outside-vitest-pool-workers',
            },
            // Overrides wrangler.toml's real 10/60s AUTH_RATE_LIMITER — several test files
            // sign up 10+ users each (admin-routes.test.ts, forms-routes.test.ts) inside a
            // single fast test run, which would otherwise trip the production limit and
            // produce spurious 429s unrelated to what each test is actually checking. The
            // FORM_SUBMISSION_RATE_LIMITER's real 5/60s value is intentionally NOT overridden
            // — forms-routes.test.ts has a dedicated test asserting its 429 behavior.
            ratelimits: {
              AUTH_RATE_LIMITER: { simple: { limit: 1000, period: 60 } },
              // Same reasoning as AUTH_RATE_LIMITER above — password-reset.test.ts and
              // recovery-codes.test.ts each make several real requests against this binding
              // per test file; recoveryRateLimit's own 429 behavior is unit-tested directly
              // against a mocked limiter instead (test/recovery-rate-limit.test.ts), the same
              // pattern auth-rate-limit.test.ts already uses.
              RECOVERY_RATE_LIMITER: { simple: { limit: 1000, period: 60 } },
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
