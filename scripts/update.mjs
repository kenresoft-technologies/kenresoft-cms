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
// What it does do: pull new code from the "upstream" git remote (see lib/git-cli.mjs), install
// dependencies, apply any new migrations (Drizzle only applies ones not yet recorded remotely —
// safe to run every time), and redeploy both Workers with the current code. This is the command
// an existing deployment should run instead of `pnpm run setup` to pick up new CMS changes,
// precisely because setup.mjs's ensureAuthSecret() used to (and other steps still do)
// prompt/act as if this were a first-ever install.
//
// Usage: pnpm run update

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pullLatestCode } from './lib/git-cli.mjs';
import { runWranglerInherit } from './lib/wrangler-cli.mjs';
import { buildAndDeployAdmin, checkWorkerOwnership, deployApi } from './lib/deploy-helpers.mjs';
import { readDatabaseId, readWorkerName } from './lib/wrangler-toml.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
const WRANGLER_TOML_PATH = join(REPO_ROOT, 'wrangler.toml');

async function main() {
  console.log('Kenresoft CMS — update an existing install\n');
  console.log('This never touches your secrets, D1/R2 resources, or CORS config.\n');

  await pullLatestCode(REPO_ROOT);

  console.log('\nInstalling dependencies...');
  execFileSync('pnpm', ['install'], { cwd: REPO_ROOT, stdio: 'inherit', shell: true });

  // Both checks read wrangler.toml *after* the pull above — its own tracked template content
  // could in principle have changed upstream (a merge conflict resolved the "wrong" way), and
  // what matters here is the config about to actually be deployed, not a pre-pull snapshot of it.
  //
  // A never-set-up clone's wrangler.toml has no database_id (ensureD1() in setup.mjs is what
  // writes it in) — reported by a real user who ran this before ever running `pnpm run setup`.
  // Without this check, migrations-apply below would fail confusingly (no D1 database configured
  // for the "DB" binding at all), or — worse, if it got past that — `wrangler deploy`'s own
  // automatic provisioning would silently kick in and half-provision a deployment missing every
  // other step setup.mjs is responsible for (BETTER_AUTH_SECRET never set, CORS never wired,
  // admin origin never added), leaving a broken, confusing, and insecure deployment behind.
  const databaseId = readDatabaseId(WRANGLER_TOML_PATH);
  if (!databaseId) {
    throw new Error(
      'This install has not been set up yet (wrangler.toml has no database_id) — run `pnpm run ' +
        'setup` first, then use `pnpm run update` for future updates.',
    );
  }

  // The other real, reported incident this guards against: `wrangler deploy` has no "already
  // exists" failure mode, so redeploying to a Worker name shared by a *different* deployment in
  // this same Cloudflare account (every fork of this template ships the same default name)
  // would silently overwrite it — this already happened for real. See checkWorkerOwnership's own
  // comment (scripts/lib/deploy-helpers.mjs) for the full reasoning. Deliberately hard-refuses
  // rather than prompting — unlike scripts/setup.mjs, this script is meant to run with zero
  // prompts, and there's no safe automatic choice to make on the update path (only setup.mjs's
  // interactive collision handling can pick a new name).
  const apiWorkerName = readWorkerName(WRANGLER_TOML_PATH);
  const ownership = checkWorkerOwnership({ workerName: apiWorkerName, cwd: API_DIR, expectedDatabaseId: databaseId });
  if (ownership.status === 'foreign') {
    throw new Error(
      `Refusing to deploy: the Worker "${apiWorkerName}" in this Cloudflare account is currently ` +
        `bound to a different D1 database (${ownership.liveDatabaseId}) than this install's own ` +
        `wrangler.toml (${databaseId}) — it belongs to a different deployment, and redeploying ` +
        'would silently overwrite it. If this install\'s Worker was genuinely renamed on ' +
        'purpose, update wrangler.toml\'s top-level `name` field to match reality; otherwise ' +
        'investigate before running this again.',
    );
  }

  console.log('\nApplying any new database migrations...');
  // "DB" (the binding, not the database's own name) — stays correct even for an install whose
  // database_name differs from the default (e.g. after setup.mjs's collision-driven rename when
  // an "already exists" conflict came up during provisioning).
  runWranglerInherit(
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', WRANGLER_TOML_PATH],
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
