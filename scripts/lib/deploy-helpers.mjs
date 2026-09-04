// Shared between scripts/setup.mjs (first install) and scripts/update.mjs (redeploying an
// existing install) — factored out so a fix to either the API/admin deploy sequence or the
// deployed-URL-extraction regex only needs to happen in one place, not drift between two.
import { execFileSync } from 'node:child_process';

import { runWrangler } from './wrangler-cli.mjs';

const WORKER_URL_RE = /https:\/\/[a-z0-9.-]+\.workers\.dev/;

// `wrangler deploy` has no "already exists" failure mode the way `d1/r2 ... create` does — every
// fork of this template ships the same default Worker name (kenresoft-cms-api/-admin), and
// deploying to a name that's already taken by an unrelated Worker in the same Cloudflare account
// (one account running more than one deployment of this template — the same real-world scenario
// scripts/setup.mjs's D1/R2 collision handling exists for) just silently overwrites it, no error,
// no warning. Confirmed as a real, reported incident: a user's `pnpm run update` replaced a
// different, unrelated deployment's live API Worker sharing the same account and default name.
//
// The one per-clone fingerprint available without reaching for the raw Cloudflare API (this
// project deliberately shells out to wrangler only — see wrangler-cli.mjs's own comment) is the
// D1 database_id this clone's own wrangler.toml records: `wrangler versions view` returns a
// version's full binding list (confirmed empirically against the real, live kenresoft-cms-api
// Worker — `resources.bindings`, one entry per binding, the D1 one carrying `database_id`), so
// comparing the *live* Worker's currently-bound database against wrangler.toml's own
// `database_id` tells us whether the name is genuinely still ours.
export function checkWorkerOwnership({ workerName, cwd, expectedDatabaseId }) {
  let versions;
  try {
    const output = runWrangler(['versions', 'list', '--name', workerName, '--json'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    versions = JSON.parse(output);
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    // Confirmed empirically: a name with no Worker behind it at all fails outright ("This Worker
    // does not exist on your account") rather than returning an empty array — nothing to
    // conflict with, safe to claim.
    if (/does not exist/i.test(stderr)) return { status: 'new' };
    throw error;
  }
  if (!Array.isArray(versions) || versions.length === 0) return { status: 'new' };

  // "The 10 most recent" isn't documented as sorted — pick the highest version number
  // explicitly rather than assuming array order.
  const latest = versions.reduce((max, version) => (version.number > max.number ? version : max));
  const detailOutput = runWrangler(['versions', 'view', latest.id, '--name', workerName, '--json'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const bindings = JSON.parse(detailOutput)?.resources?.bindings ?? [];
  const liveDatabaseId = bindings.find((binding) => binding.type === 'd1')?.database_id ?? null;

  return liveDatabaseId === expectedDatabaseId
    ? { status: 'ours' }
    : { status: 'foreign', liveDatabaseId };
}

export function deployApi({ apiDir, wranglerTomlPath }) {
  console.log('Deploying the API Worker...');
  const output = runWrangler(['deploy', '--config', wranglerTomlPath], { cwd: apiDir });
  process.stdout.write(output);
  const match = output.match(WORKER_URL_RE);
  if (!match) {
    throw new Error('Could not find the deployed Worker URL in `wrangler deploy` output — deploy may have failed.');
  }
  return match[0];
}

// Builds apps/admin against `apiUrl` (baked in at build time — see apps/admin/README.md) and
// deploys it as its own Worker. Shells out to `pnpm --filter` (with shell:true) rather than
// resolving vite's own binary directly — pnpm's strict per-package linking doesn't guarantee
// apps/admin's `vite` devDependency is reachable from a root-level script the way wrangler is
// (resolved once, fixed location); letting pnpm itself resolve and run apps/admin's own `build`
// script sidesteps that entirely. No user-controlled values are interpolated into this command,
// so shell:true carries none of the quoting/escaping risk scripts/lib/wrangler-cli.mjs's own
// comment warns about for wrangler invocations specifically.
export function buildAndDeployAdmin({ repoRoot, adminDir, apiUrl }) {
  console.log('\nBuilding the admin app...');
  execFileSync('pnpm', ['--filter', '@kenresoft-cms/admin', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_API_URL: apiUrl },
  });

  console.log('Deploying the admin app (its own Worker — apps/admin/wrangler.toml)...');
  const output = runWrangler(['deploy'], { cwd: adminDir });
  process.stdout.write(output);
  const match = output.match(WORKER_URL_RE);
  if (!match) {
    throw new Error('Could not find the deployed admin Worker URL in `wrangler deploy` output — deploy may have failed.');
  }
  return match[0];
}
