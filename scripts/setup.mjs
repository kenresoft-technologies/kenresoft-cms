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

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runWrangler, runWranglerInherit } from './lib/wrangler-cli.mjs';
import { buildAndDeployAdmin, deployApi } from './lib/deploy-helpers.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
// wrangler.toml lives at the repo root, not apps/api/ (see that file's own top comment) — the
// "Deploy to Cloudflare" button only detects a config there.
const WRANGLER_TOML_PATH = join(REPO_ROOT, 'wrangler.toml');

const rl = createInterface({ input: process.stdin, output: process.stdout });
async function ask(question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || '';
}
async function confirm(question, defaultYes) {
  const suffix = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${suffix}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

function readToml() {
  return readFileSync(WRANGLER_TOML_PATH, 'utf8');
}
function writeToml(content) {
  writeFileSync(WRANGLER_TOML_PATH, content);
}

// Isolates the top-level (not [env.production.*]) array-table block for `header` — e.g.
// "[[d1_databases]]" — so edits never touch Kenresoft's own pinned production section, which
// uses the distinctly-named "[[env.production.d1_databases]]" header instead.
function findTopLevelBlock(toml, header) {
  const start = toml.indexOf(`${header}\n`);
  if (start === -1) return null;
  const bodyStart = start + header.length + 1;
  const nextHeader = toml.slice(bodyStart).search(/\n\[/);
  const end = nextHeader === -1 ? toml.length : bodyStart + nextHeader + 1;
  return { start, end, text: toml.slice(start, end) };
}

function insertAfterLine(blockText, anchorLine, newLine) {
  const idx = blockText.indexOf(anchorLine);
  if (idx === -1) {
    throw new Error(`Expected to find the line "${anchorLine.trim()}" in wrangler.toml — has the file's shape changed?`);
  }
  const insertAt = idx + anchorLine.length;
  return blockText.slice(0, insertAt) + newLine + blockText.slice(insertAt);
}

function replaceLine(toml, linePrefix, newLine) {
  const lines = toml.split('\n');
  const idx = lines.findIndex((line) => line.startsWith(linePrefix));
  if (idx === -1) throw new Error(`Expected to find a line starting with "${linePrefix}" in wrangler.toml.`);
  lines[idx] = newLine;
  return lines.join('\n');
}

async function ensureD1() {
  const toml = readToml();
  const block = findTopLevelBlock(toml, '[[d1_databases]]');
  if (!block) throw new Error('Could not find [[d1_databases]] in wrangler.toml.');
  if (/\bdatabase_id\s*=/.test(block.text)) {
    console.log('✓ D1 database already configured (database_id present) — skipping.');
    return;
  }

  console.log('Creating D1 database "kenresoft-cms-db"...');
  // `--json` was removed from `d1 create` in current wrangler (confirmed empirically against
  // 4.126.0 — it now errors "Unknown argument: json" outright, breaking this step for every
  // fresh install). `--update-config` looked like the obvious replacement but, also confirmed
  // empirically, silently no-ops against a wrangler.toml (this repo's format) even with a
  // matching --binding — it only ever prints the same manual-instructions snippet, never writes
  // it. Wrangler's own TOML-vs-JSON-config guidance ("newer features are JSON-only") lines up
  // with that. Parsing the plain-text snippet's own `database_id = "..."` line is the only
  // option left for a repo that stays on wrangler.toml.
  const output = runWrangler(['d1', 'create', 'kenresoft-cms-db'], { cwd: API_DIR });
  const match = output.match(/database_id\s*=\s*"([^"]+)"/);
  const databaseId = match?.[1];
  if (!databaseId) {
    throw new Error(`Could not find database_id in \`wrangler d1 create\` output: ${output}`);
  }
  console.log(`Created D1 database: ${databaseId}`);

  const newBlockText = insertAfterLine(block.text, 'database_name = "kenresoft-cms-db"\n', `database_id = "${databaseId}"\n`);
  writeToml(readToml().slice(0, block.start) + newBlockText + readToml().slice(block.end));
}

async function ensureR2() {
  const toml = readToml();
  const block = findTopLevelBlock(toml, '[[r2_buckets]]');
  if (!block) throw new Error('Could not find [[r2_buckets]] in wrangler.toml.');
  if (/\bbucket_name\s*=/.test(block.text)) {
    console.log('✓ R2 bucket already configured (bucket_name present) — skipping.');
    return;
  }

  console.log('Creating R2 bucket "kenresoft-cms-media"...');
  runWrangler(['r2', 'bucket', 'create', 'kenresoft-cms-media'], { cwd: API_DIR });

  const newBlockText = insertAfterLine(block.text, 'binding = "MEDIA_BUCKET"\n', 'bucket_name = "kenresoft-cms-media"\n');
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

async function maybeSetUpEmail() {
  const choice = (await ask('Set up password-reset email now? [skip/cloudflare/resend]', 'skip')).toLowerCase();
  if (choice === 'skip' || !choice) {
    console.log('Skipping — password reset will still work, it just won\'t send an email (docs/DEPLOYMENT.md).');
    return;
  }
  if (choice !== 'cloudflare' && choice !== 'resend') {
    console.log(`Unrecognized choice "${choice}" — skipping email setup.`);
    return;
  }

  const emailFrom = await ask('Send from which address?', 'noreply@yourdomain.example');
  let toml = readToml();
  toml = toml.includes('EMAIL_PROVIDER =')
    ? toml
    : replaceLine(toml, 'BETTER_AUTH_URL =', `BETTER_AUTH_URL = "https://REPLACE_AFTER_FIRST_DEPLOY.workers.dev"\nEMAIL_PROVIDER = "${choice}"\nEMAIL_FROM = "${emailFrom}"`);
  writeToml(toml);

  if (choice === 'resend') {
    const apiKey = await ask('Paste your Resend API key');
    runWrangler(['secret', 'put', 'RESEND_API_KEY', '--config', WRANGLER_TOML_PATH], { cwd: API_DIR, input: apiKey });
    console.log('✓ Resend configured.');
  } else {
    console.log('Cloudflare Email selected — you still need to add a [[send_email]] binding to');
    console.log('wrangler.toml and run `wrangler email sending enable` yourself (needs');
    console.log('interactive domain verification this script can\'t automate). See docs/DEPLOYMENT.md.');
  }
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

async function main() {
  console.log('Kenresoft CMS — guided setup\n');

  console.log('Checking Cloudflare authentication...');
  runWranglerInherit(['whoami'], { cwd: API_DIR });

  await ensureD1();
  await ensureR2();

  console.log('Applying database migrations...');
  runWranglerInherit(
    ['d1', 'migrations', 'apply', 'kenresoft-cms-db', '--remote', '--config', WRANGLER_TOML_PATH],
    { cwd: API_DIR },
  );

  await ensureAuthSecret();
  await maybeSetUpEmail();

  const firstUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`\nFirst deploy done: ${firstUrl}`);

  console.log('Setting BETTER_AUTH_URL to the real deployed URL and redeploying...');
  writeToml(replaceLine(readToml(), 'BETTER_AUTH_URL =', `BETTER_AUTH_URL = "${firstUrl}"`));
  const finalUrl = deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  console.log(`\n✓ API deployed: ${finalUrl}`);

  const adminUrl = buildAndDeployAdmin({ repoRoot: REPO_ROOT, adminDir: ADMIN_DIR, apiUrl: finalUrl });

  console.log(`\nAdmin deployed: ${adminUrl}`);
  if (addCorsOrigin(adminUrl)) {
    console.log('Added the admin origin to CORS_ORIGINS — redeploying once more...');
    deployApi({ apiDir: API_DIR, wranglerTomlPath: WRANGLER_TOML_PATH });
  } else {
    console.log('✓ Admin origin already present in CORS_ORIGINS — skipping (running setup again is safe).');
  }

  console.log('\n✓ CMS installed — sign up at the admin URL below (the first account becomes owner):');
  console.log(`  API:   ${finalUrl}`);
  console.log(`  Admin: ${adminUrl}`);
  rl.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  rl.close();
  process.exit(1);
});
