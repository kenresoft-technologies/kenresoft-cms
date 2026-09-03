#!/usr/bin/env node
// Redeploys an *existing* Kenresoft CMS install after pulling in new CMS code — the safe subset
// of scripts/setup.mjs's first-install flow, deliberately leaving out everything that provisions
// new resources or touches secrets/config a running deployment already depends on:
//   - Does NOT create or re-provision D1/R2 (ensureD1/ensureR2 in setup.mjs are also skip-if-
//     present, so re-running full setup wouldn't have duplicated them either — but this script
//     never even calls them, since an update has nothing to provision in the first place).
//   - Does NOT touch BETTER_AUTH_SECRET at all. Applies even after setup.mjs's own fix to check
//     before overwriting it: an update should never even ask.
//   - Does NOT touch CORS_ORIGINS — the admin Worker's URL never changes between deploys of the
//     same Worker, so there's never a new origin to add on an update.
//   - Does NOT re-run the interactive email setup prompt.
// What it does do: install dependencies, apply any new migrations (Drizzle only applies ones not
// yet recorded remotely — safe to run every time), and redeploy both Workers with the current
// code. This is the command an existing deployment should run instead of `pnpm run setup` to
// pick up new CMS changes, precisely because setup.mjs's ensureAuthSecret() used to (and other
// steps still do) prompt/act as if this were a first-ever install.
//
// Usage: pnpm run update

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runWranglerInherit } from './lib/wrangler-cli.mjs';
import { buildAndDeployAdmin, deployApi } from './lib/deploy-helpers.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
const WRANGLER_TOML_PATH = join(REPO_ROOT, 'wrangler.toml');

async function main() {
  console.log('Kenresoft CMS — update an existing install\n');
  console.log(
    "This assumes you've already pulled the new code (git pull / git fetch upstream && git merge\n" +
      'upstream/<branch> — see docs/DEPLOYMENT.md). This script only installs, migrates, and\n' +
      'redeploys; it never touches your secrets, D1/R2 resources, or CORS config.\n',
  );

  console.log('Installing dependencies...');
  execFileSync('pnpm', ['install'], { cwd: REPO_ROOT, stdio: 'inherit', shell: true });

  console.log('\nApplying any new database migrations...');
  runWranglerInherit(
    ['d1', 'migrations', 'apply', 'kenresoft-cms-db', '--remote', '--config', WRANGLER_TOML_PATH],
    { cwd: API_DIR },
  );

  const apiUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`\n✓ API redeployed: ${apiUrl}`);

  const adminUrl = buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl });
  console.log(`\n✓ Admin redeployed: ${adminUrl}`);

  console.log('\n✓ Update complete — no secrets, resources, or CORS config were touched.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
