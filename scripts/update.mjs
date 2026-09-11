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
// What it does do (bare `pnpm run update`, no flags): pull new code from the "upstream" git
// remote (see lib/git-cli.mjs), install dependencies, apply any new migrations (Drizzle only
// applies ones not yet recorded remotely — safe to run every time), and redeploy both Workers
// with the current code. This is the command an existing deployment should run instead of
// `pnpm run setup` to pick up new CMS changes, precisely because setup.mjs's ensureAuthSecret()
// used to (and other steps still do) prompt/act as if this were a first-ever install.
//
// Targeted reconfiguration: `pnpm run update -- --auth` / `--email` / `--storage` / `--database`
// modifies exactly that one configuration category (scripts/lib/configure.mjs) and does NOT pull
// code, install deps, or touch any other category — the two concerns (picking up new CMS code vs.
// changing this deployment's own configuration) are deliberately kept separate, per this
// project's non-negotiable rule that a value only ever changes when explicitly requested. Add
// `--ci` for non-interactive use (reads `*_NEW` environment variables instead of prompting; an
// omitted variable always means "leave unchanged" — see configure.mjs).
//
// Which branch to pull: bare `pnpm run update` follows upstream's actual default branch,
// auto-detected every run (see lib/git-cli.mjs) — correct for a real install, which should
// always track whatever the project currently ships as stable. A deployment deliberately used
// for *testing* pre-release code (e.g. a staging install that wants to try `develop` before it
// reaches `main`) can override this per run with `--branch <name>`, or set it once via the
// `UPDATE_BRANCH` environment variable so every future `pnpm run update` in that checkout keeps
// using it without repeating the flag — an explicit `--branch` always wins over `UPDATE_BRANCH`
// if both are given.
//
// Usage:
//   pnpm run update
//   pnpm run update -- --auth [--ci]
//   pnpm run update -- --email [--ci]
//   pnpm run update -- --storage
//   pnpm run update -- --database
//   pnpm run update -- --branch develop     # or: UPDATE_BRANCH=develop pnpm run update

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pullLatestCode } from './lib/git-cli.mjs';
import { runWranglerInherit } from './lib/wrangler-cli.mjs';
import { buildAndDeployAdmin, checkWorkerOwnership, deployApi } from './lib/deploy-helpers.mjs';
import { readDatabaseId, readWorkerName } from './lib/wrangler-toml.mjs';
import { readInstallStatus, summarizeInstallStatus } from './lib/config-status.mjs';
import { configureAuth, configureDatabase, configureEmail, configureStorage } from './lib/configure.mjs';
import { closePrompt } from './lib/prompt.mjs';
import { parseUpdateArgs } from './lib/update-args.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
const WRANGLER_TOML_PATH = join(REPO_ROOT, 'wrangler.toml');

const CONFIGURE_FNS = { auth: configureAuth, email: configureEmail, storage: configureStorage, database: configureDatabase };

async function runTargetedConfigure(configureFn, ci) {
  console.log('Kenresoft CMS — update configuration\n');
  const status = readInstallStatus({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  if (!status.database.configured) {
    throw new Error('This install has not been set up yet — run `pnpm run setup` first.');
  }
  console.log(summarizeInstallStatus(status));

  let result;
  try {
    result = await configureFn({ wranglerTomlPath: WRANGLER_TOML_PATH, apiDir: API_DIR, status, ci });
  } finally {
    closePrompt();
  }
  if (!result.changed) {
    console.log('\nNo changes made.');
    return;
  }
  if (result.redeployNeeded) {
    console.log('\nRedeploying the API Worker with the updated configuration...');
    const apiUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
    console.log(`✓ Redeployed: ${apiUrl}`);
  } else {
    console.log('\n✓ Change applied (took effect immediately — no redeploy needed for this field).');
  }
}

async function main() {
  const { ci, branch, category } = parseUpdateArgs(process.argv.slice(2));
  if (category) {
    await runTargetedConfigure(CONFIGURE_FNS[category], ci);
    return;
  }

  console.log('Kenresoft CMS — update an existing install\n');
  console.log('This never touches your secrets, D1/R2 resources, CORS config, or other application configuration.\n');
  if (branch) console.log(`Pulling explicitly requested branch: ${branch}\n`);

  await pullLatestCode(REPO_ROOT, { branch });

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
