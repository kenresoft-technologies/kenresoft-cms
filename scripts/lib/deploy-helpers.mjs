// Shared between scripts/setup.mjs (first install) and scripts/update.mjs (redeploying an
// existing install) — factored out so a fix to either the API/admin deploy sequence or the
// deployed-URL-extraction regex only needs to happen in one place, not drift between two.
import { execFileSync } from 'node:child_process';

import { runWrangler } from './wrangler-cli.mjs';

const WORKER_URL_RE = /https:\/\/[a-z0-9.-]+\.workers\.dev/;

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
