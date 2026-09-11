#!/usr/bin/env node
// Guided first-deploy setup — the "CLI approach" alongside the manual walkthrough
// (docs/DEPLOYMENT.md) and the "Deploy to Cloudflare" button (README.md). Provisions D1 + R2 if
// missing, applies migrations, sets BETTER_AUTH_SECRET, deploys the API Worker, fixes up
// BETTER_AUTH_URL (unknowable before a first deploy — a Worker has no *.workers.dev URL until
// then), then builds and deploys apps/admin as its own Worker (apps/admin/wrangler.toml — static
// assets, not Cloudflare Pages; see that file's own comment for why) and wires its origin into
// the API's CORS_ORIGINS afterward. Two independent Workers, one command — this is the whole
// point of this script rather than a merged single-Worker deploy: apps/admin keeps talking to
// the API purely over VITE_API_URL + fetch(), exactly as it does in local dev, so nothing about
// that integration needs to change for this to work. Shells out to wrangler directly rather than
// any Cloudflare API client — see scripts/lib/wrangler-cli.mjs's own comment for why (mirrors
// apps/api/scripts/recover-owner.mjs).
//
// Targets the top-level (generic, auto-provisioning-ready) wrangler.toml config only — never
// [env.production], which is Kenresoft's own real, already-provisioned deployment. Running this
// against an already-provisioned wrangler.toml (database_id/bucket_name already present) is
// safe: those steps are skipped rather than re-run.
//
// Usage: pnpm run setup

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runWrangler, runWranglerInherit } from './lib/wrangler-cli.mjs';
import { buildAndDeployAdmin, checkWorkerOwnership, deployApi, resolveAdminApiUrl } from './lib/deploy-helpers.mjs';
import { ask, closePrompt, confirm, select } from './lib/prompt.mjs';
import {
  extractTomlValue,
  findTopLevelBlock,
  insertAfterLine,
  readTomlFile,
  readVarLine,
  readWorkerName,
  replaceLine,
  writeTomlFile,
  writeWorkerName,
} from './lib/wrangler-toml.mjs';
import { isFreshInstall, isRealAuthUrl, readInstallStatus, summarizeInstallStatus } from './lib/config-status.mjs';
import {
  configureAdminDomain,
  configureAuth,
  configureDatabase,
  configureDomain,
  configureEmail,
  configureStorage,
} from './lib/configure.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
// wrangler.toml lives at the repo root, not apps/api/ (see that file's own top comment) — the
// "Deploy to Cloudflare" button only detects a config there.
const WRANGLER_TOML_PATH = join(REPO_ROOT, 'wrangler.toml');
const ADMIN_WRANGLER_TOML_PATH = join(ADMIN_DIR, 'wrangler.toml');

// Thin, path-bound wrappers — every call site below already assumes a single implicit target
// file (the API's wrangler.toml); readTomlFile/writeTomlFile (scripts/lib/wrangler-toml.mjs) are
// the path-parameterized versions, needed once this file also has to touch the *admin* Worker's
// separate wrangler.toml (ensureWorkerNamesAreOurs, below).
function readToml() {
  return readTomlFile(WRANGLER_TOML_PATH);
}
function writeToml(content) {
  writeTomlFile(WRANGLER_TOML_PATH, content);
}

// Runs a wrangler `... info --json` lookup and reports whether the resource is genuinely still
// there, rather than trusting that a `database_id`/`bucket_name` already sitting in wrangler.toml
// means the underlying Cloudflare resource still exists — it could have been deleted out-of-band
// (dashboard, another script, account cleanup) since the file was written, in which case treating
// "config has an id" as "resource exists" would skip provisioning and only fail later, deeper
// into the setup. `notFoundPattern` distinguishes "genuinely doesn't exist" (recreate it) from
// any other failure (auth, network, rate limit — re-thrown, since silently recreating a resource
// setup can't actually confirm is gone would be worse than just stopping). Confirmed empirically
// against the real Cloudflare API, not assumed: a missing D1 database's `d1 info` fails with
// "Couldn't find a D1 DB..." while a missing R2 bucket's `r2 bucket info` fails with "The
// specified bucket does not exist" — different enough wording that each call site passes its own
// pattern rather than sharing one regex.
function resourceExists(infoArgs, notFoundPattern) {
  try {
    runWrangler(infoArgs, { cwd: API_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    if (notFoundPattern.test(stderr)) return false;
    throw error;
  }
}

// A D1 database / R2 bucket name only has to be unique *within one Cloudflare account* — but
// every fork of this template ships the same default name, and one account commonly ends up
// hosting more than one deployment of it (e.g. an agency running several client sites from a
// single account, or someone re-running this script after an earlier attempt got far enough to
// create the resource but not far enough to record its id in wrangler.toml — a re-clone instead
// of reusing the same folder is enough to lose that). `wrangler d1/r2 ... create <name>` then
// fails with "already exists", which used to just crash the whole setup outright. Real users hit
// exactly this — see the CLAUDE.md changelog entry this fix corresponds to.
//
// Fixed by catching that specific failure and asking for a different name instead, with an
// auto-generated suggestion so accepting the default (just press Enter) is enough for the common
// case. Returns the name that actually succeeded (which callers must persist into wrangler.toml's
// own `database_name`/`bucket_name` field) alongside create()'s own result — `wrangler d1 info`/
// `wrangler r2 bucket info` (this file's own existence checks, and anyone else who ever needs to
// look this resource up by name rather than by binding) only accept the resource's real,
// account-side name, confirmed via `wrangler d1 info --help`/`wrangler r2 bucket info --help`, so
// a stale name left behind after a collision-driven rename would make every later existence
// check falsely report "doesn't exist" and silently create — and switch the binding over to — a
// second, unrelated resource.
async function createUniqueResource({ kind, defaultName, create }) {
  let name = defaultName;
  for (;;) {
    try {
      return { name, result: create(name) };
    } catch (error) {
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      if (!/already exists/i.test(stderr)) throw error;

      const suggestion = `${defaultName}-${randomBytes(2).toString('hex')}`;
      console.log(
        `\n⚠ A ${kind} named "${name}" already exists in this Cloudflare account — likely from a ` +
          'previous setup run, or another deployment of this project sharing the same account. ' +
          "This name is never seen by end users, so any unique value works — press Enter to accept\n" +
          'the suggestion below, or type your own.',
      );
      name = await ask(`Name for this ${kind}`, suggestion);
    }
  }
}

async function ensureD1() {
  const toml = readToml();
  const block = findTopLevelBlock(toml, '[[d1_databases]]');
  if (!block) throw new Error('Could not find [[d1_databases]] in wrangler.toml.');
  const hasExistingId = /\bdatabase_id\s*=/.test(block.text);
  // database_name is never omitted the way database_id is (see the file's own comment), so this
  // reads back whatever name a previous run actually settled on — the fallback only matters for
  // a wrangler.toml edited by hand into an unexpected shape.
  const currentName = extractTomlValue(block.text, 'database_name') ?? 'kenresoft-cms-db';
  if (hasExistingId) {
    if (resourceExists(['d1', 'info', currentName, '--json'], /couldn't find/i)) {
      console.log('✓ D1 database already configured and confirmed present on Cloudflare — skipping.');
      return;
    }
    console.log(
      `⚠ wrangler.toml has a database_id, but "${currentName}" no longer exists on Cloudflare ` +
        '(deleted outside this script?) — recreating it.',
    );
  }

  console.log('Creating D1 database...');
  // `--json` was removed from `d1 create` in current wrangler (confirmed empirically against
  // 4.126.0 — it now errors "Unknown argument: json" outright, breaking this step for every
  // fresh install). `--update-config` looked like the obvious replacement but, also confirmed
  // empirically, silently no-ops against a wrangler.toml (this repo's format) even with a
  // matching --binding — it only ever prints the same manual-instructions snippet, never writes
  // it. Wrangler's own TOML-vs-JSON-config guidance ("newer features are JSON-only") lines up
  // with that. Parsing the plain-text snippet's own `database_id = "..."` line is the only
  // option left for a repo that stays on wrangler.toml.
  const { name: databaseName, result: databaseId } = await createUniqueResource({
    kind: 'D1 database',
    defaultName: currentName,
    create: (name) => {
      const output = runWrangler(['d1', 'create', name], { cwd: API_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
      const match = output.match(/database_id\s*=\s*"([^"]+)"/);
      if (!match?.[1]) throw new Error(`Could not find database_id in \`wrangler d1 create\` output: ${output}`);
      return match[1];
    },
  });
  console.log(`Created D1 database "${databaseName}": ${databaseId}`);

  let newBlockText = hasExistingId
    ? block.text.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`)
    : insertAfterLine(block.text, `database_name = "${currentName}"\n`, `database_id = "${databaseId}"\n`);
  if (databaseName !== currentName) {
    newBlockText = newBlockText.replace(/database_name\s*=\s*"[^"]*"/, `database_name = "${databaseName}"`);
  }
  writeToml(readToml().slice(0, block.start) + newBlockText + readToml().slice(block.end));
}

async function ensureR2() {
  const toml = readToml();
  const block = findTopLevelBlock(toml, '[[r2_buckets]]');
  if (!block) throw new Error('Could not find [[r2_buckets]] in wrangler.toml.');
  const hasExistingName = /\bbucket_name\s*=/.test(block.text);
  const currentName = extractTomlValue(block.text, 'bucket_name') ?? 'kenresoft-cms-media';
  if (hasExistingName) {
    if (resourceExists(['r2', 'bucket', 'info', currentName, '--json'], /does not exist/i)) {
      console.log('✓ R2 bucket already configured and confirmed present on Cloudflare — skipping.');
      return;
    }
    console.log(
      `⚠ wrangler.toml has a bucket_name, but "${currentName}" no longer exists on Cloudflare ` +
        '(deleted outside this script?) — recreating it.',
    );
  }

  console.log('Creating R2 bucket...');
  // R2 has no separate id field the way D1 does — bucket_name *is* the real identifier, so
  // (unlike database_id above) there's nothing to fall back on if this doesn't end up matching
  // whatever name actually got created; always keep them in sync below.
  const { name: bucketName } = await createUniqueResource({
    kind: 'R2 bucket',
    defaultName: currentName,
    create: (name) => {
      runWrangler(['r2', 'bucket', 'create', name], { cwd: API_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
      return name;
    },
  });
  console.log(`Created R2 bucket: ${bucketName}`);

  const newBlockText = hasExistingName
    ? block.text.replace(/bucket_name\s*=\s*"[^"]*"/, `bucket_name = "${bucketName}"`)
    : insertAfterLine(block.text, 'binding = "MEDIA_BUCKET"\n', `bucket_name = "${bucketName}"\n`);
  writeToml(readToml().slice(0, block.start) + newBlockText + readToml().slice(block.end));
}

// Checks whether BETTER_AUTH_SECRET is already set on the Worker before touching it — re-running
// `pnpm run setup` used to unconditionally regenerate and overwrite it every time, silently
// invalidating every existing user's session (better-auth signs session tokens with this secret)
// on what looked like a harmless re-run, e.g. for an update. There's no Worker to query yet on a
// genuinely first-ever run (before the first `wrangler deploy`), which `wrangler secret list`
// reports as a distinct, catchable "Worker ... not found" error rather than an empty list —
// confirmed empirically, not assumed. Overrides runWrangler's default stderr:'inherit' with
// 'pipe' for this one call — also confirmed empirically that error.stderr is otherwise `null`,
// since 'inherit' sends it straight to the terminal instead of the thrown error object, which
// would have made the "not found" check below silently never match. Any failure other than
// "not found" still re-throws instead of being silently swallowed.
async function ensureAuthSecret() {
  let alreadySet = false;
  try {
    const output = runWrangler(
      ['secret', 'list', '--config', WRANGLER_TOML_PATH, '--format', 'json'],
      { cwd: API_DIR, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const secrets = JSON.parse(output);
    alreadySet = secrets.some((s) => s.name === 'BETTER_AUTH_SECRET');
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    if (!/not found/i.test(stderr)) throw error;
  }

  if (alreadySet) {
    const rotate = await confirm(
      'BETTER_AUTH_SECRET is already set on this Worker. Rotate it? This immediately logs out every currently signed-in user',
      false,
    );
    if (!rotate) {
      console.log('✓ BETTER_AUTH_SECRET already set — leaving it unchanged.');
      return;
    }
  }

  const useGenerated = await confirm('Generate BETTER_AUTH_SECRET automatically?', true);
  const secret = useGenerated ? randomBytes(32).toString('base64url') : await ask('Paste your own BETTER_AUTH_SECRET value');
  runWrangler(['secret', 'put', 'BETTER_AUTH_SECRET', '--config', WRANGLER_TOML_PATH], { cwd: API_DIR, input: secret });
  console.log('✓ BETTER_AUTH_SECRET set.');
  return secret;
}

// Idempotent: re-running `pnpm run setup` against an already-deployed admin Worker must not
// keep appending the same origin to CORS_ORIGINS every time — parses the existing comma-separated
// list and only writes back (and reports a change) if `origin` isn't already one of its entries.
function addCorsOrigin(origin) {
  const toml = readToml();
  const match = toml.match(/CORS_ORIGINS = "([^"]*)"/);
  if (!match) throw new Error('Could not find CORS_ORIGINS in wrangler.toml.');

  const existing = match[1].split(',').map((entry) => entry.trim()).filter(Boolean);
  if (existing.includes(origin)) return false;

  const updatedList = [...existing, origin].join(',');
  writeToml(toml.replace(/CORS_ORIGINS = "([^"]*)"/, `CORS_ORIGINS = "${updatedList}"`));
  return true;
}

// Unlike `d1/r2 ... create`, `wrangler deploy` has no "already exists" failure mode — every fork
// of this template ships the same default Worker names, and deploying to a name already taken by
// an unrelated Worker in the same Cloudflare account (one account running more than one
// deployment of this template — the scenario ensureD1()/ensureR2()'s own collision handling
// exists for) just silently overwrites it. Confirmed as a real, reported incident: `pnpm run
// update` replaced a different, unrelated deployment's live API Worker sharing the same account
// and default name. Runs once, right before the very first deploy of a run — a genuine re-run of
// setup for an already-established install (whose name was already vetted the first time) always
// resolves as "ours" below and never has to ask again.
async function ensureWorkerNamesAreOurs() {
  const databaseId = extractTomlValue(findTopLevelBlock(readToml(), '[[d1_databases]]').text, 'database_id');
  if (!databaseId) throw new Error('Expected database_id to already be set by ensureD1() before this step.');

  const originalApiName = readWorkerName(WRANGLER_TOML_PATH);
  let apiName = originalApiName;
  for (;;) {
    const status = checkWorkerOwnership({ workerName: apiName, cwd: API_DIR, expectedDatabaseId: databaseId });
    if (status.status !== 'foreign') break;
    console.log(
      `\n⚠ A Worker named "${apiName}" already exists in this Cloudflare account, bound to a ` +
        'different D1 database than this install — deploying would silently overwrite an ' +
        'unrelated deployment (most likely another install of this same project sharing the ' +
        'same account).',
    );
    const suggestion = apiName.endsWith('-api')
      ? `${apiName.slice(0, -4)}-${randomBytes(2).toString('hex')}-api`
      : `${apiName}-${randomBytes(2).toString('hex')}`;
    apiName = await ask('Enter a different name for the API Worker', suggestion);
  }
  if (apiName !== originalApiName) {
    writeWorkerName(WRANGLER_TOML_PATH, apiName);
    console.log(`✓ API Worker will deploy as "${apiName}".`);
  }
  if (apiName === originalApiName) return;

  // The default API name collided, so this account most likely already has another install of
  // this same project using the paired default admin name too — rename it the same way, deriving
  // from the now-confirmed-safe API name. The admin Worker has no bindings of its own to compare
  // (it's assets-only — see its own wrangler.toml's comment), so there's nothing to verify
  // ownership *by*; existence under the newly-derived name is the best available signal, and a
  // second, unrelated collision on top of a freshly random-suffixed name is vanishingly unlikely.
  // A sentinel no real binding could ever equal — checkWorkerOwnership's comparison always fails
  // against it, so "exists" (any binding, or none at all) always reads as 'foreign' here, never
  // a false 'ours'. What we actually want is a plain existence check; the admin Worker has no
  // binding to compare "ours" against at all.
  const impossibleId = `impossible-${randomBytes(16).toString('hex')}`;
  let adminName = apiName.endsWith('-api') ? apiName.replace(/-api$/, '-admin') : `${apiName}-admin`;
  while (checkWorkerOwnership({ workerName: adminName, cwd: ADMIN_DIR, expectedDatabaseId: impossibleId }).status !== 'new') {
    adminName = `${adminName}-${randomBytes(2).toString('hex')}`;
  }
  writeWorkerName(ADMIN_WRANGLER_TOML_PATH, adminName);
  console.log(`✓ Admin Worker will deploy as "${adminName}" (paired rename, same reason as above).`);
}

// The full first-install sequence — also safe to run again (every step already preserves an
// existing, valid value by default: ensureD1()/ensureR2() skip a confirmed-present resource,
// ensureAuthSecret() only rotates on explicit confirmation, configureEmail() only touches email
// when the developer picks "change", and BETTER_AUTH_URL is only ever overwritten below while
// it's still the pre-deploy placeholder — never once a real value, custom domain included, is in
// place). This is what a fresh install runs automatically, and what "Reconfigure everything"
// below re-runs on an existing one.
async function runFullFlow() {
  await ensureD1();
  await ensureR2();

  console.log('Applying database migrations...');
  // "DB" (the binding, not the database's own name) — stays correct even if ensureD1() above
  // just settled on a different real database_name to dodge an "already exists" collision.
  runWranglerInherit(
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', WRANGLER_TOML_PATH],
    { cwd: API_DIR },
  );

  await ensureAuthSecret();
  await configureEmail({ wranglerTomlPath: WRANGLER_TOML_PATH, apiDir: API_DIR, status: readInstallStatus({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH }) });
  await ensureWorkerNamesAreOurs();

  const currentAuthUrl = readVarLine(readToml(), 'BETTER_AUTH_URL');
  const authUrlWasPlaceholder = !isRealAuthUrl(currentAuthUrl);

  const firstUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`\nFirst deploy done: ${firstUrl}`);

  let finalUrl = firstUrl;
  if (authUrlWasPlaceholder) {
    // Only the pre-deploy placeholder is ever safe to fill in automatically — a real value
    // (including a previous run's own *.workers.dev URL, or a custom domain someone edited in by
    // hand) is a load-bearing config value and is left untouched. Use
    // `pnpm run update -- --auth` to change it deliberately instead.
    console.log('Setting BETTER_AUTH_URL to the real deployed URL and redeploying...');
    writeToml(replaceLine(readToml(), 'BETTER_AUTH_URL =', `BETTER_AUTH_URL = "${firstUrl}"`));
    finalUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  } else {
    console.log(`✓ BETTER_AUTH_URL already configured (${currentAuthUrl}) — leaving it unchanged.`);
  }
  console.log(`\n✓ API deployed: ${finalUrl}`);

  const adminApiUrl = resolveAdminApiUrl({ wranglerTomlPath: WRANGLER_TOML_PATH, deployedWorkerUrl: finalUrl });
  const adminUrl = buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl: adminApiUrl });

  console.log(`\nAdmin deployed: ${adminUrl}`);

  // Without this, the password-reset email link falls back to CORS_ORIGINS' first entry
  // (lib/env.ts's own documented fallback) — which, once addCorsOrigin() below appends this
  // exact adminUrl to the *end* of that list, is never the value it should be. Setting the
  // secret directly (not a wrangler.toml var) takes effect immediately, no redeploy needed.
  runWrangler(['secret', 'put', 'ADMIN_URL', '--config', WRANGLER_TOML_PATH], { cwd: API_DIR, input: adminUrl });
  console.log('✓ ADMIN_URL set — password-reset emails will link to the real admin URL.');

  if (addCorsOrigin(adminUrl)) {
    console.log('Added the admin origin to CORS_ORIGINS — redeploying once more...');
    deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  } else {
    console.log('✓ Admin origin already present in CORS_ORIGINS — skipping (running setup again is safe).');
  }

  console.log('\n✓ CMS installed/updated — sign up at the admin URL below (the first account becomes owner):');
  console.log(`  API:   ${finalUrl}`);
  console.log(`  Admin: ${adminUrl}`);
}

// "Continue without changes" — redeploy current, unmodified configuration. No provisioning, no
// prompts, nothing in wrangler.toml is touched.
async function redeployOnly() {
  console.log('\nApplying any new database migrations...');
  runWranglerInherit(
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', WRANGLER_TOML_PATH],
    { cwd: API_DIR },
  );
  const apiUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`\n✓ API redeployed: ${apiUrl}`);
  const adminApiUrl = resolveAdminApiUrl({ wranglerTomlPath: WRANGLER_TOML_PATH, deployedWorkerUrl: apiUrl });
  const adminUrl = buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl: adminApiUrl });
  console.log(`✓ Admin redeployed: ${adminUrl}`);
}

const CONFIGURE_CATEGORIES = {
  auth: configureAuth,
  email: configureEmail,
  storage: configureStorage,
  database: configureDatabase,
  domain: configureDomain,
};

// "Update configuration" — loop letting the developer pick exactly which category(ies) to touch,
// same functions `pnpm run update -- --auth`/`--email`/etc. use standalone, so the two entry
// points can never drift into different behavior for the same category.
async function runUpdateConfigurationMenu() {
  let anyChanged = false;
  for (;;) {
    const status = readInstallStatus({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
    console.log(`\n${summarizeInstallStatus(status)}`);
    const category = await select('\nWhich category do you want to update?', [
      { value: 'auth', label: 'Better Auth URL' },
      { value: 'email', label: 'Email (Resend / Cloudflare Email)' },
      { value: 'storage', label: 'Storage (R2)' },
      { value: 'database', label: 'Database (D1)' },
      { value: 'domain', label: 'Custom domain / workers.dev (API Worker)' },
      { value: 'admin-domain', label: 'Custom domain / workers.dev (Admin Worker)' },
      { value: 'done', label: 'Done' },
    ]);
    if (category === 'done') break;

    // configureAdminDomain targets a completely separate wrangler.toml (apps/admin's) and deploys
    // the Admin Worker itself as part of every step, including refreshing the ADMIN_URL secret —
    // it never delegates to this loop's own API-Worker-only redeploy block below.
    if (category === 'admin-domain') {
      const result = await configureAdminDomain({
        adminWranglerTomlPath: ADMIN_WRANGLER_TOML_PATH,
        adminDir: ADMIN_DIR,
        apiWranglerTomlPath: WRANGLER_TOML_PATH,
        apiDir: API_DIR,
      });
      if (result.changed) anyChanged = true;
      continue;
    }

    const result = await CONFIGURE_CATEGORIES[category]({ wranglerTomlPath: WRANGLER_TOML_PATH, apiDir: API_DIR, status });
    if (result.changed) {
      anyChanged = true;
      if (result.redeployNeeded) {
        console.log('\nRedeploying the API Worker with the updated configuration...');
        const apiUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
        // A Better Auth URL change is the one category the admin app's own build depends on
        // (VITE_API_URL) — see resolveAdminApiUrl's own comment. Every other category (email,
        // storage, database) has no bearing on what URL the admin app should call.
        if (category === 'auth') {
          console.log('Rebuilding and redeploying the admin app against the updated URL...');
          const adminApiUrl = resolveAdminApiUrl({ wranglerTomlPath: WRANGLER_TOML_PATH, deployedWorkerUrl: apiUrl });
          buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl: adminApiUrl });
        }
      }
    }
  }
  console.log(anyChanged ? '\n✓ Configuration updated.' : '\nNo changes made.');
}

async function main() {
  console.log('Kenresoft CMS — guided setup\n');

  console.log('Checking Cloudflare authentication...');
  runWranglerInherit(['whoami'], { cwd: API_DIR });

  const status = readInstallStatus({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  if (!isFreshInstall(status)) {
    console.log('\nExisting installation detected.\n');
    console.log(summarizeInstallStatus(status));
    const choice = await select('\nWhat would you like to do?', [
      { value: 'continue', label: 'Continue without changes' },
      { value: 'update', label: 'Update configuration' },
      { value: 'reconfigure', label: 'Reconfigure everything' },
      { value: 'cancel', label: 'Cancel' },
    ]);
    if (choice === 'cancel') {
      console.log('Cancelled — nothing changed.');
      closePrompt();
      return;
    }
    if (choice === 'continue') {
      await redeployOnly();
      closePrompt();
      return;
    }
    if (choice === 'update') {
      await runUpdateConfigurationMenu();
      closePrompt();
      return;
    }
    // 'reconfigure' falls through to the same full flow a fresh install runs — every step in it
    // already preserves an existing valid value by default (see runFullFlow's own comment), so
    // "reconfigure everything" really means "walk through every step's own prompts again",
    // not "discard and regenerate everything unconditionally".
  }

  await runFullFlow();
  closePrompt();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  closePrompt();
  process.exit(1);
});
