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
      // Each test file gets its own isolated Miniflare/workerd runtime (a real D1 + R2 + Worker
      // simulation, not a lightweight mock) — running all ~39 of them concurrently, as vitest
      // does by default, contends hard enough for CPU/memory on a constrained runner (GitHub
      // Actions' standard 2-vCPU runners; this project's own Windows dev machines hit the same
      // wall, documented repeatedly throughout CLAUDE.md as "run individually/in small batches").
      // CI ran the full suite as one unbatched `vitest run` and started seeing real, non-code
      // failures from it — timeouts and spurious 500s from tests that pass cleanly alone —
      // confirmed by re-running every failing file individually with zero code changes and
      // getting 100% pass. `fileParallelism: false` serializes file execution (still isolated
      // per file, just not concurrent), trading CI wall-clock time for determinism — the same
      // trade-off this project's own local verification practice already makes by hand.
      fileParallelism: false,
      // The default 5000ms is tight for a real D1+Worker-backed request even locally, and CI's
      // shared runners are measurably slower under load — the same serialization fix above cut
      // CI failures from 7 files to 2, and the one remaining non-race failure was a plain
      // `Test timed out in 5000ms` on an otherwise-passing request. Real requests taking longer
      // under CI resource pressure isn't a bug to chase; give them realistic headroom instead.
      testTimeout: 20000,
      hookTimeout: 20000,
      poolOptions: {
        workers: {
          // wrangler.test.toml, not wrangler.toml — see that file's own top comment. The real
          // config's top-level D1/R2 bindings deliberately omit their id/name for reusability
          // (automatic provisioning on a real deploy), which this offline test pool can't work
          // with at all — it needs concrete placeholder values to key its local Miniflare state.
          wrangler: { configPath: './wrangler.test.toml' },
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
              // Set here so commerce-payments.test.ts can exercise the "configured" path (webhook
              // signature verification is pure local HMAC computation against this exact value,
              // no real network call) via a real SELF.fetch. Tests that need
              // initializeTransaction/verifyTransaction (which really do call
              // https://api.paystack.co) mock `fetch` instead of relying on this key being a real
              // credential — this project's tests stay hermetic, never depending on a real
              // third-party account or network access to pass.
              PAYSTACK_SECRET_KEY: 'sk_test_only_paystack_secret_not_used_outside_vitest_pool_workers',
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
