import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Dedicated ports (not 8787/5173) and a dedicated D1 persist-to location (e2e/setup.mjs,
// wiped before every run) — so this suite never collides with, or clobbers the content of, a
// developer's normal `pnpm dev`/`wrangler dev` instances. reuseExistingServer is deliberately
// always false: setup.mjs resets local D1 state on every invocation, so an already-running
// E2E server from a previous run would be holding a connection to a sqlite file that no
// longer exists.
const API_PORT = 8788;
const ADMIN_PORT = 5183;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Strictly sequential: 01-admin-flows.spec.ts's owner signup must complete before anything
  // else signs up (docs/ARCHITECTURE.md §10, first signup becomes owner) — file-level
  // parallelism (the default with >1 worker) would race that.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${ADMIN_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // --config ../../wrangler.toml: wrangler.toml lives at the repo root (README.md's "Deploy
      // to Cloudflare" button only detects a config there), not apps/api/ — explicit rather
      // than relying on wrangler's own upward directory search finding it from this cwd.
      command: `pnpm exec wrangler dev --port ${API_PORT} --config ../../wrangler.toml --persist-to .wrangler/e2e-state --var CORS_ORIGINS:http://localhost:${ADMIN_PORT} --var BETTER_AUTH_URL:http://localhost:${API_PORT}`,
      cwd: path.resolve(import.meta.dirname, '../api'),
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec vite --mode e2e --port ${ADMIN_PORT} --strictPort`,
      cwd: import.meta.dirname,
      url: `http://localhost:${ADMIN_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
