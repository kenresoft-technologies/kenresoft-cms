// Prepares a clean, isolated environment for the E2E suite before Playwright starts its
// webServers. Runs as a plain script (not Playwright's globalSetup) specifically so the D1
// reset below happens BEFORE any wrangler dev process exists to hold its files open — Windows
// can't delete a file another process has open, and Playwright's globalSetup/webServer start
// ordering isn't something worth depending on to get that right.
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const adminDir = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]e2e$/, '');
const repoRoot = path.resolve(adminDir, '../..');

const envFile = path.join(adminDir, '.env.e2e');
if (!existsSync(envFile)) {
  copyFileSync(path.join(adminDir, '.env.e2e.example'), envFile);
}

// A dedicated persist-to location — never the developer's normal `wrangler dev` local D1
// (which may hold real-ish content they're working with) — reset on every run so the E2E
// suite's "first signup becomes owner" assumption (docs/ARCHITECTURE.md §10) holds every time,
// not just the first.
rmSync(path.join(repoRoot, 'apps/api/.wrangler/e2e-state'), { recursive: true, force: true });

execSync('pnpm --filter @kenresoft/database migrate:e2e', {
  stdio: 'inherit',
  cwd: repoRoot,
});
