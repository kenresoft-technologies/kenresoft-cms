#!/usr/bin/env node
// R2 media backup/restore — closes the "no scripted R2 backup" gap noted in
// docs/DEPLOYMENT.md's Backups and recovery section (D1 already has a verified export/restore
// path; R2 media file bytes didn't have an equivalent). There's no bucket-level export command
// in R2/wrangler, so this walks the `media` table (the one source of truth for which R2 keys
// exist — apps/api/src/routes/admin/media.ts) and downloads/uploads each object individually
// via `wrangler r2 object get/put`, the same "shell out to wrangler, no driver of our own"
// approach recover-owner.mjs uses for D1.
//
// A backup is a directory: manifest.json (every media row's metadata, keyed by R2 key) plus an
// objects/ tree mirroring each key's own path (media/<uuid>.<ext>) with the actual file bytes.
// Restoring only repopulates R2 — it's the file-bytes half of a disaster recovery, meant to run
// alongside restoring the `media` table's own D1 backup (docs/DEPLOYMENT.md), not a replacement
// for it, since D1 is still what makes those R2 keys discoverable by the app at all.
//
// Usage:
//   node scripts/backup-media.mjs backup --local --out ./media-backup
//   node scripts/backup-media.mjs backup --remote --out ./media-backup
//   node scripts/backup-media.mjs restore --local --from ./media-backup
//   node scripts/backup-media.mjs restore --remote --from ./media-backup
//   node scripts/backup-media.mjs backup --remote --env production --out ./media-backup
//     (only if your real D1/R2 live under a named environment — Kenresoft's own repo state
//     does, via [env.production]; most forks' don't need this flag at all)
//
// (Or via the package.json scripts: `pnpm backup-media -- --remote --out ./media-backup`.)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const DB_NAME = 'kenresoft-cms-db';
// Must match your bucket's actual name. Safe by default if you used the explicit
// `wrangler r2 bucket create kenresoft-cms-media --update-config` from docs/DEPLOYMENT.md's
// step 3 — but a bucket left to wrangler's automatic provisioning (bucket_name omitted
// entirely from wrangler.toml) gets an auto-generated, worker-name-prefixed name instead, not
// this literal string. Check the repo root's wrangler.toml's [[r2_buckets]] (or
// [env.<name>.r2_buckets] if you keep your real deployment under a named environment, like
// Kenresoft's own [env.production] does) and update this constant to match if it differs.
const BUCKET_NAME = 'kenresoft-cms-media';
// wrangler.toml lives at the repo root, not apps/api/ (see that file's own top comment) —
// apps/api/scripts/ -> apps/api/ -> apps/ -> repo root needs three "../" (verified empirically).
const CONFIG_PATH = new URL('../../../wrangler.toml', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

function runWrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function runD1Query(targetArgs, sql) {
  const output = runWrangler(['d1', 'execute', DB_NAME, ...targetArgs, '--json', '--command', sql, '--config', CONFIG_PATH]);
  const parsed = JSON.parse(output);
  const statementResult = Array.isArray(parsed) ? parsed[0] : parsed;
  return statementResult?.results ?? [];
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode !== 'backup' && mode !== 'restore') {
    console.error('First argument must be "backup" or "restore".');
    process.exit(1);
  }

  const args = { mode, local: false, remote: false, dir: undefined, env: undefined };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--local') args.local = true;
    else if (arg === '--remote') args.remote = true;
    else if (arg === '--out' || arg === '--from') args.dir = rest[++i];
    // Most deployments keep their real D1/R2 in wrangler.toml's top level (the default this
    // flag needs no value for) — Kenresoft's own repo state is the one exception, since its
    // real, live resources are pinned under a named [env.production] instead (wrangler.toml's
    // own comment explains why). Pass --env production for that; anyone with an equivalent
    // named-environment split of their own passes whatever they called it.
    else if (arg === '--env') args.env = rest[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (args.local === args.remote) {
    console.error('Pass exactly one of --local or --remote.');
    process.exit(1);
  }
  if (!args.dir) {
    console.error(mode === 'backup' ? 'Pass --out <directory>.' : 'Pass --from <directory>.');
    process.exit(1);
  }
  return args;
}

function backup(target, targetArgs, dir) {
  const rows = runD1Query(
    targetArgs,
    'SELECT key, filename, content_type as contentType, size, width, height, alt_text as altText, ' +
      'created_at as createdAt, updated_at as updatedAt FROM media ORDER BY created_at;',
  );

  const objectsDir = join(dir, 'objects');
  mkdirSync(objectsDir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(rows, null, 2));

  console.log(`Backing up ${rows.length} media object(s) from ${target.slice(2)} to ${resolve(dir)}...`);
  rows.forEach((row, i) => {
    const destPath = join(objectsDir, row.key);
    mkdirSync(dirname(destPath), { recursive: true });
    runWrangler(['r2', 'object', 'get', `${BUCKET_NAME}/${row.key}`, '--file', destPath, ...targetArgs, '--config', CONFIG_PATH]);
    console.log(`  [${i + 1}/${rows.length}] ${row.key}`);
  });

  console.log(`Done. manifest.json + ${rows.length} object(s) written to ${resolve(dir)}.`);
}

function restore(target, targetArgs, dir) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`No manifest.json found in ${resolve(dir)} — is this a backup produced by this script's "backup" mode?`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(manifestPath, 'utf8'));

  console.log(`Restoring ${rows.length} media object(s) from ${resolve(dir)} to ${target.slice(2)}...`);
  rows.forEach((row, i) => {
    const srcPath = join(dir, 'objects', row.key);
    if (!existsSync(srcPath)) {
      console.error(`  [${i + 1}/${rows.length}] MISSING, skipped: ${row.key}`);
      return;
    }
    runWrangler([
      'r2', 'object', 'put', `${BUCKET_NAME}/${row.key}`,
      '--file', srcPath,
      '--content-type', row.contentType,
      ...targetArgs, '--config', CONFIG_PATH,
    ]);
    console.log(`  [${i + 1}/${rows.length}] ${row.key}`);
  });

  console.log('Done. Restores only R2 object bytes — restore the corresponding D1 backup separately (docs/DEPLOYMENT.md) so the `media` table still points at these keys.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.local ? '--local' : '--remote';
  const targetArgs = args.env ? [target, '--env', args.env] : [target];
  if (args.mode === 'backup') backup(target, targetArgs, args.dir);
  else restore(target, targetArgs, args.dir);
}

main();
