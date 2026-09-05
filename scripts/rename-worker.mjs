#!/usr/bin/env node
// Renames the API or Admin Worker — i.e. changes its *.workers.dev URL. Cloudflare has no
// in-place Worker rename: this deploys a *new* Worker under the new name (the old one keeps
// running, unmodified, at its old URL, until you delete it or leave it idle) and then fixes up
// every place in this install that references the old URL:
//   - Renaming the API Worker changes its own URL, which is baked into the admin app's build
//     (VITE_API_URL) and stored in BETTER_AUTH_URL — both get updated, and the admin app is
//     rebuilt and redeployed so it actually talks to the new URL. CORS_ORIGINS/ADMIN_URL don't
//     need touching — neither depends on the API's own URL.
//   - Renaming the Admin Worker changes the origin the API's CORS allow-list and ADMIN_URL
//     (used to build password-reset email links) need to reflect — both get updated. The API
//     doesn't need rebuilding for this, only a var-only redeploy; VITE_API_URL doesn't change.
//
// Usage:
//   pnpm run rename-worker -- --target api --name my-new-api-name
//   pnpm run rename-worker -- --target admin --name my-new-admin-name

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runWrangler, runWranglerInherit } from './lib/wrangler-cli.mjs';
import { buildAndDeployAdmin, checkWorkerOwnership, deployApi } from './lib/deploy-helpers.mjs';
import { closePrompt, confirm } from './lib/prompt.mjs';
import { readDatabaseId, readTomlFile, readWorkerName, replaceLine, writeTomlFile, writeWorkerName } from './lib/wrangler-toml.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
const WRANGLER_TOML_PATH = join(REPO_ROOT, 'wrangler.toml');
const ADMIN_WRANGLER_TOML_PATH = join(ADMIN_DIR, 'wrangler.toml');

function parseArgs(argv) {
  const args = { target: undefined, name: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') args.target = argv[++i];
    else if (arg === '--name') args.name = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (args.target !== 'api' && args.target !== 'admin') {
    console.error('Usage: pnpm run rename-worker -- --target api|admin --name <new-worker-name>');
    process.exit(1);
  }
  if (!args.name) {
    console.error('Missing --name <new-worker-name>.');
    process.exit(1);
  }
  return args;
}

// Reads a `KEY = "value"` var straight out of wrangler.toml's [vars] section — used to recover
// this install's own current API URL (stored in BETTER_AUTH_URL) when renaming the *admin*
// Worker, which doesn't have that URL recorded anywhere of its own (it's assets-only, no vars).
function readVar(toml, key) {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match?.[1] ?? null;
}

// The counterpart to setup.mjs's addCorsOrigin() (which only ever appends) — renaming the admin
// Worker retires its old origin, so the allow-list needs the old one *replaced*, not just a new
// one tacked on next to a now-dead entry.
function replaceCorsOrigin(oldOrigin, newOrigin) {
  const toml = readTomlFile(WRANGLER_TOML_PATH);
  const match = toml.match(/CORS_ORIGINS = "([^"]*)"/);
  if (!match) throw new Error('Could not find CORS_ORIGINS in wrangler.toml.');
  const existing = match[1].split(',').map((entry) => entry.trim()).filter(Boolean);
  const updated = existing.includes(oldOrigin)
    ? existing.map((entry) => (entry === oldOrigin ? newOrigin : entry))
    : [...existing, newOrigin];
  writeTomlFile(WRANGLER_TOML_PATH, toml.replace(/CORS_ORIGINS = "([^"]*)"/, `CORS_ORIGINS = "${updated.join(',')}"`));
}

async function renameApi(newName) {
  const databaseId = readDatabaseId(WRANGLER_TOML_PATH);
  if (!databaseId) {
    throw new Error('wrangler.toml has no database_id yet — run `pnpm run setup` before renaming anything.');
  }
  const oldName = readWorkerName(WRANGLER_TOML_PATH);
  if (newName === oldName) {
    console.log(`Already named "${newName}" — nothing to do.`);
    return;
  }

  const ownership = checkWorkerOwnership({ workerName: newName, cwd: API_DIR, expectedDatabaseId: databaseId });
  if (ownership.status === 'foreign') {
    throw new Error(
      `"${newName}" is already a Worker in this Cloudflare account, bound to a different D1 ` +
        'database — it belongs to something else. Choose a different name.',
    );
  }

  console.log(`\nThis will:`);
  console.log(`  1. Deploy a new Worker named "${newName}" (the current one, "${oldName}", keeps running as-is).`);
  console.log('  2. Update BETTER_AUTH_URL and redeploy.');
  console.log('  3. Rebuild and redeploy the admin app so it talks to the new URL.');
  console.log(`  4. Ask whether to delete the old "${oldName}" Worker.`);
  if (!(await confirm('\nProceed?', false))) {
    console.log('Aborted.');
    return;
  }

  writeWorkerName(WRANGLER_TOML_PATH, newName);
  const firstUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`✓ Deployed as "${newName}": ${firstUrl}`);

  writeTomlFile(WRANGLER_TOML_PATH, replaceLine(readTomlFile(WRANGLER_TOML_PATH), 'BETTER_AUTH_URL =', `BETTER_AUTH_URL = "${firstUrl}"`));
  const finalUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`✓ BETTER_AUTH_URL updated, redeployed: ${finalUrl}`);

  const adminUrl = buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl: finalUrl });
  console.log(`✓ Admin rebuilt against the new API URL and redeployed: ${adminUrl}`);

  console.log(`\nNew API URL: ${finalUrl}`);
  console.log(`The old Worker "${oldName}" is still live, unmodified, at its old URL — it no longer receives updates from this install.`);
  if (await confirm(`Delete the old "${oldName}" Worker now?`, false)) {
    runWranglerInherit(['delete', oldName], { cwd: API_DIR });
  } else {
    console.log(`Left in place — delete it later with: wrangler delete ${oldName}`);
  }
}

async function renameAdmin(newName) {
  const oldName = readWorkerName(ADMIN_WRANGLER_TOML_PATH);
  if (newName === oldName) {
    console.log(`Already named "${newName}" — nothing to do.`);
    return;
  }

  // The admin Worker is assets-only — no bindings of its own to verify ownership *by* (see
  // ensureWorkerNamesAreOurs() in setup.mjs for the same reasoning). A sentinel no real binding
  // could ever equal turns checkWorkerOwnership into a plain existence check here.
  const impossibleId = `impossible-${Date.now()}`;
  const ownership = checkWorkerOwnership({ workerName: newName, cwd: ADMIN_DIR, expectedDatabaseId: impossibleId });
  if (ownership.status !== 'new') {
    throw new Error(`"${newName}" is already a Worker in this Cloudflare account. Choose a different name.`);
  }

  const apiUrl = readVar(readTomlFile(WRANGLER_TOML_PATH), 'BETTER_AUTH_URL');
  if (!apiUrl || apiUrl.includes('REPLACE_AFTER_FIRST_DEPLOY')) {
    throw new Error('Could not determine this install\'s current API URL from wrangler.toml — deploy the API first.');
  }

  console.log(`\nThis will:`);
  console.log(`  1. Deploy a new Worker named "${newName}" (the current one, "${oldName}", keeps running as-is).`);
  console.log('  2. Update the API\'s CORS_ORIGINS and ADMIN_URL to the new origin, and redeploy the API.');
  console.log(`  3. Ask whether to delete the old "${oldName}" Worker.`);
  if (!(await confirm('\nProceed?', false))) {
    console.log('Aborted.');
    return;
  }

  writeWorkerName(ADMIN_WRANGLER_TOML_PATH, newName);
  const newAdminUrl = buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl });
  console.log(`✓ Deployed as "${newName}": ${newAdminUrl}`);

  // Cloudflare's workers.dev subdomain is fixed per account — deriving the old URL from the
  // just-deployed new one's own suffix avoids needing a second network round trip to look it up.
  const subdomainSuffix = newAdminUrl.replace(/^https:\/\/[a-z0-9-]+\./, '');
  const oldAdminUrl = `https://${oldName}.${subdomainSuffix}`;

  replaceCorsOrigin(oldAdminUrl, newAdminUrl);
  runWrangler(['secret', 'put', 'ADMIN_URL', '--config', WRANGLER_TOML_PATH], { cwd: API_DIR, input: newAdminUrl });
  const apiRedeployUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`✓ CORS_ORIGINS and ADMIN_URL updated, API redeployed: ${apiRedeployUrl}`);

  console.log(`\nNew Admin URL: ${newAdminUrl}`);
  console.log(`The old Worker "${oldName}" is still live, unmodified, at its old URL — it's no longer referenced by the API's config.`);
  if (await confirm(`Delete the old "${oldName}" Worker now?`, false)) {
    runWranglerInherit(['delete', oldName], { cwd: ADMIN_DIR });
  } else {
    console.log(`Left in place — delete it later with: wrangler delete ${oldName}`);
  }
}

async function main() {
  const { target, name } = parseArgs(process.argv.slice(2));
  console.log(`Kenresoft CMS — rename the ${target === 'api' ? 'API' : 'admin'} Worker\n`);

  if (target === 'api') await renameApi(name);
  else await renameAdmin(name);

  closePrompt();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  closePrompt();
  process.exit(1);
});
