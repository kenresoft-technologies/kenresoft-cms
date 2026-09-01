#!/usr/bin/env node
// Guided first-deploy setup — the "CLI approach" alongside the manual walkthrough
// (docs/DEPLOYMENT.md) and the "Deploy to Cloudflare" button (README.md). Provisions D1 + R2 if
// missing, applies migrations, sets BETTER_AUTH_SECRET, deploys the API, fixes up
// BETTER_AUTH_URL (unknowable before a first deploy — a Worker has no *.workers.dev URL until
// then), and optionally deploys apps/admin to Cloudflare Pages, wiring its CORS origin back into
// the API afterward. Shells out to wrangler directly rather than any Cloudflare API client — see
// scripts/lib/wrangler-cli.mjs's own comment for why (mirrors apps/api/scripts/recover-owner.mjs).
//
// Targets the top-level (generic, auto-provisioning-ready) wrangler.toml config only — never
// [env.production], which is Kenresoft's own real, already-provisioned deployment. Running this
// against an already-provisioned wrangler.toml (database_id/bucket_name already present) is
// safe: those steps are skipped rather than re-run.
//
// Usage: pnpm run setup

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runWrangler, runWranglerInherit } from './lib/wrangler-cli.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const ADMIN_DIR = join(REPO_ROOT, 'apps', 'admin');
const WRANGLER_TOML_PATH = join(API_DIR, 'wrangler.toml');

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
  if (!block) throw new Error('Could not find [[d1_databases]] in apps/api/wrangler.toml.');
  if (/\bdatabase_id\s*=/.test(block.text)) {
    console.log('✓ D1 database already configured (database_id present) — skipping.');
    return;
  }

  console.log('Creating D1 database "kenresoft-cms-db"...');
  const output = runWrangler(['d1', 'create', 'kenresoft-cms-db', '--json'], { cwd: API_DIR });
  // wrangler prints { "d1_databases": [{ "binding": ..., "database_name": ..., "database_id": ... }] }
  // for `d1 create --json` — if this shape ever changes, fail loudly rather than write garbage.
  const parsed = JSON.parse(output);
  const databaseId = parsed?.d1_databases?.[0]?.database_id;
  if (!databaseId) {
    throw new Error(`Could not find database_id in \`wrangler d1 create --json\` output: ${output}`);
  }
  console.log(`Created D1 database: ${databaseId}`);

  const newBlockText = insertAfterLine(block.text, 'database_name = "kenresoft-cms-db"\n', `database_id = "${databaseId}"\n`);
  writeToml(readToml().slice(0, block.start) + newBlockText + readToml().slice(block.end));
}

async function ensureR2() {
  const toml = readToml();
  const block = findTopLevelBlock(toml, '[[r2_buckets]]');
  if (!block) throw new Error('Could not find [[r2_buckets]] in apps/api/wrangler.toml.');
  if (/\bbucket_name\s*=/.test(block.text)) {
    console.log('✓ R2 bucket already configured (bucket_name present) — skipping.');
    return;
  }

  console.log('Creating R2 bucket "kenresoft-cms-media"...');
  runWrangler(['r2', 'bucket', 'create', 'kenresoft-cms-media'], { cwd: API_DIR });

  const newBlockText = insertAfterLine(block.text, 'binding = "MEDIA_BUCKET"\n', 'bucket_name = "kenresoft-cms-media"\n');
  writeToml(readToml().slice(0, block.start) + newBlockText + readToml().slice(block.end));
}

async function ensureAuthSecret() {
  const useGenerated = await confirm('Generate BETTER_AUTH_SECRET automatically?', true);
  const secret = useGenerated ? randomBytes(32).toString('base64url') : await ask('Paste your own BETTER_AUTH_SECRET value');
  runWrangler(['secret', 'put', 'BETTER_AUTH_SECRET'], { cwd: API_DIR, input: secret });
  console.log('✓ BETTER_AUTH_SECRET set.');
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
    runWrangler(['secret', 'put', 'RESEND_API_KEY'], { cwd: API_DIR, input: apiKey });
    console.log('✓ Resend configured.');
  } else {
    console.log('Cloudflare Email selected — you still need to add a [[send_email]] binding to');
    console.log('apps/api/wrangler.toml and run `wrangler email sending enable` yourself (needs');
    console.log('interactive domain verification this script can\'t automate). See docs/DEPLOYMENT.md.');
  }
}

function deployApi() {
  console.log('Deploying the API Worker...');
  const output = runWrangler(['deploy'], { cwd: API_DIR });
  process.stdout.write(output);
  const match = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/);
  if (!match) {
    throw new Error('Could not find the deployed Worker URL in `wrangler deploy` output — deploy may have failed.');
  }
  return match[0];
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

  const firstUrl = deployApi();
  console.log(`\nFirst deploy done: ${firstUrl}`);

  console.log('Setting BETTER_AUTH_URL to the real deployed URL and redeploying...');
  writeToml(replaceLine(readToml(), 'BETTER_AUTH_URL =', `BETTER_AUTH_URL = "${firstUrl}"`));
  const finalUrl = deployApi();
  console.log(`\n✓ API deployed: ${finalUrl}`);

  if (await confirm('\nAlso deploy the admin app to Cloudflare Pages now?', false)) {
    const projectName = await ask('Cloudflare Pages project name', 'kenresoft-cms-admin');
    try {
      runWranglerInherit(['pages', 'project', 'create', projectName, '--production-branch', 'main'], { cwd: ADMIN_DIR });
    } catch {
      console.log(`(Pages project "${projectName}" may already exist — continuing.)`);
    }

    console.log('Building the admin app...');
    // Shells out to `pnpm --filter` (with shell:true) rather than resolving vite's own binary
    // directly — pnpm's strict per-package linking doesn't guarantee apps/admin's `vite`
    // devDependency is reachable from a root-level script the way wrangler is (resolved once,
    // fixed location); letting pnpm itself resolve and run apps/admin's own `build` script
    // sidesteps that entirely. Unlike scripts/lib/wrangler-cli.mjs's wrangler invocations, no
    // user-controlled values are interpolated into this command, so shell:true carries none of
    // the quoting/escaping risk that trick was written to avoid.
    execFileSync('pnpm', ['--filter', '@kenresoft/admin', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, VITE_API_URL: finalUrl },
    });

    console.log('Deploying to Cloudflare Pages...');
    const pagesOutput = runWrangler(['pages', 'deploy', 'dist', '--project-name', projectName], { cwd: ADMIN_DIR });
    process.stdout.write(pagesOutput);
    const pagesMatch = pagesOutput.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/);
    if (!pagesMatch) {
      console.log('Could not find the deployed Pages URL in the output above — add it to CORS_ORIGINS yourself.');
    } else {
      const adminUrl = pagesMatch[0];
      console.log(`Admin deployed: ${adminUrl}`);
      console.log('Adding it to the API\'s CORS_ORIGINS and redeploying once more...');
      const toml = readToml();
      const updated = toml.replace(/CORS_ORIGINS = "([^"]*)"/, (_m, origins) => `CORS_ORIGINS = "${origins},${adminUrl}"`);
      writeToml(updated);
      deployApi();
      console.log(`\n✓ Admin deployed: ${adminUrl}`);
    }
  }

  console.log('\nDone. Sign up at the admin URL above — the first account becomes owner.');
  rl.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  rl.close();
  process.exit(1);
});
