// Shared between scripts/setup.mjs (first install) and scripts/update.mjs (redeploying an
// existing install) — factored out so a fix to either the API/admin deploy sequence or the
// deployed-URL-extraction regex only needs to happen in one place, not drift between two.
import { execFileSync } from 'node:child_process';

import { runWrangler } from './wrangler-cli.mjs';
import { readCustomDomainRoutes, readTomlFile, readVarLine } from './wrangler-toml.mjs';
import { isRealAuthUrl } from './config-status.mjs';

const WORKER_URL_RE = /https:\/\/[a-z0-9.-]+\.workers\.dev/;
const CUSTOM_DOMAIN_LINE_RE = /^\s*([a-z0-9.-]+)\s*\(custom domain\)/m;

// `wrangler deploy`'s own stdout prints a *.workers.dev line only when that route is enabled —
// confirmed as a real, live regression: once workers_dev is disabled (this project's own
// --domain command can do that, and a dashboard toggle already did it once for real), the output
// only ever shows a "<domain> (custom domain)" line instead, and the old workers.dev-only regex
// below found nothing, throwing "Could not find the deployed Worker URL" even though the deploy
// genuinely succeeded — breaking `pnpm run update` outright. Prefers workers.dev when present
// (existing behavior, unchanged for every install that still has it enabled) and falls back to
// the first custom domain route otherwise.
export function extractDeployedUrl(output) {
  const devMatch = output.match(WORKER_URL_RE);
  if (devMatch) return devMatch[0];
  const domainMatch = output.match(CUSTOM_DOMAIN_LINE_RE);
  return domainMatch ? `https://${domainMatch[1]}` : null;
}

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

// The admin app's own build-time API base URL (VITE_API_URL) should point at this deployment's
// real public API origin. `deployApi()` above always returns the Worker's raw *.workers.dev URL
// from `wrangler deploy`'s own output — correct for a fresh install that has no custom domain
// yet, but wrong once one is configured: BETTER_AUTH_URL already holds the deployment's intended
// public address (a custom domain, or a previous run's own workers.dev URL) and is the value
// every other part of this config already treats as authoritative. Confirmed as a real, live
// incident: disabling the API Worker's workers.dev route (to force traffic through a connected
// custom domain only) broke the admin app, which had been built against the workers.dev URL
// `deployApi()` returned even though BETTER_AUTH_URL was already correctly set to the custom
// domain — this function is what makes those two stay in sync going forward. Only the pre-deploy
// placeholder falls back to the just-deployed workers.dev URL; any other value already means "use
// this," the same rule setup.mjs's own BETTER_AUTH_URL-fill-in logic already follows.
export function resolveAdminApiUrl({ wranglerTomlPath, deployedWorkerUrl }) {
  const authUrl = readVarLine(readTomlFile(wranglerTomlPath), 'BETTER_AUTH_URL');
  return isRealAuthUrl(authUrl) ? authUrl : deployedWorkerUrl;
}

// The value ADMIN_URL (a secret, used to build password-reset/verification email links) should
// hold — the admin Worker's own real public origin, preferring a connected custom domain over its
// *.workers.dev URL, the same "a real configured value wins over the auto-detected one" rule
// resolveAdminApiUrl above already applies to the API side. Confirmed as a real, live gap: nothing
// previously refreshed ADMIN_URL after a custom domain was connected to the admin Worker — it
// stayed pinned to whatever workers.dev URL the very first `pnpm run setup` run happened to set it
// to, so every email link kept pointing at workers.dev regardless.
export function resolvePublicAdminUrl({ adminWranglerTomlPath, deployedAdminUrl }) {
  const domains = readCustomDomainRoutes(readTomlFile(adminWranglerTomlPath));
  return domains.length > 0 ? `https://${domains[0]}` : deployedAdminUrl;
}

export function deployApi({ apiDir, wranglerTomlPath }) {
  console.log('Deploying the API Worker...');
  const output = runWrangler(['deploy', '--config', wranglerTomlPath], { cwd: apiDir });
  process.stdout.write(output);
  const url = extractDeployedUrl(output);
  if (!url) {
    throw new Error('Could not find the deployed Worker URL in `wrangler deploy` output — deploy may have failed.');
  }
  return url;
}

// Deploys the admin Worker as-is, without rebuilding `dist/` first — used when only wrangler.toml
// config (routes, workers_dev) changed, not the app's own bundle/VITE_API_URL, so a full
// `pnpm --filter build` would be redundant work.
export function deployAdminOnly({ adminDir }) {
  console.log('Deploying the admin app (its own Worker — apps/admin/wrangler.toml)...');
  const output = runWrangler(['deploy'], { cwd: adminDir });
  process.stdout.write(output);
  const url = extractDeployedUrl(output);
  if (!url) {
    throw new Error('Could not find the deployed admin Worker URL in `wrangler deploy` output — deploy may have failed.');
  }
  return url;
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

  return deployAdminOnly({ adminDir });
}
