#!/usr/bin/env node
// Emergency owner-recovery CLI — for a fully locked-out installation where someone with real
// access to the deployment's environment (its Cloudflare account / wrangler auth) needs to
// reset the owner's password directly. This is the preferred recovery path over the
// break-glass HTTP endpoint (POST /api/v1/system/recover-owner) whenever this kind of access
// is available, since it needs no standing secret configured on the Worker at all.
//
// Deliberately does NOT accept the new password as a CLI argument (visible in shell history
// and `ps`) — it's always prompted for interactively. Shells out to `wrangler d1 execute`
// rather than talking to D1 directly, so this script has no database driver of its own and
// inherits whatever auth wrangler is already configured with (an API token, `wrangler login`,
// etc.) instead of needing its own credentials.
//
// Usage:
//   node scripts/recover-owner.mjs --local            # against the local dev D1
//   node scripts/recover-owner.mjs --remote            # against the real deployed D1
//   node scripts/recover-owner.mjs --remote --email owner@example.com   # if there's more than one owner
//
// (Or via the package.json scripts: `pnpm recover-owner:local` / `pnpm recover-owner:remote`.)

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from 'better-auth/crypto';

const require = createRequire(import.meta.url);

const DB_NAME = 'kenresoft-cms-db';
const CONFIG_PATH = new URL('../wrangler.toml', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// Invoked as a plain Node script rather than through pnpm/npx — those resolve to a .CMD shell
// wrapper on Windows, which execFileSync can't run without shell:true, and shelling out with a
// SQL string containing quotes is worth avoiding even when the input is operator-controlled.
// wrangler's package.json "exports" doesn't expose ./bin/wrangler.js as an importable subpath
// (it's meant to be run via its `bin` field, not required), so resolve the package root instead
// and join the known bin path onto it rather than resolving the script file directly.
const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

// Control-code points rather than literal escape characters in string literals — easier to
// read and edit correctly than embedding raw control bytes in source.
const CHAR_CODE = { LF: 10, CR: 13, BACKSPACE: 8, DEL: 127, CTRL_C: 3, CTRL_D: 4 };

function parseArgs(argv) {
  const args = { local: false, remote: false, email: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local') args.local = true;
    else if (arg === '--remote') args.remote = true;
    else if (arg === '--email') args.email = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function escapeSqlString(value) {
  return value.replace(/'/g, "''");
}

function runWrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function runD1Query(target, sql) {
  const output = runWrangler(['d1', 'execute', DB_NAME, target, '--json', '--command', sql, '--config', CONFIG_PATH]);
  const parsed = JSON.parse(output);
  const statementResult = Array.isArray(parsed) ? parsed[0] : parsed;
  return statementResult?.results ?? [];
}

function runD1Statement(target, sql) {
  runWrangler(['d1', 'execute', DB_NAME, target, '--command', sql, '--config', CONFIG_PATH]);
}

// Masked, raw-mode single-character reads for a real terminal.
async function promptPasswordMasked(query) {
  return new Promise((resolve, reject) => {
    process.stdout.write(query);
    let input = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (chunk) => {
      const code = chunk.charCodeAt(0);
      if (code === CHAR_CODE.LF || code === CHAR_CODE.CR || code === CHAR_CODE.CTRL_D) {
        cleanup();
        process.stdout.write('\n');
        resolve(input);
      } else if (code === CHAR_CODE.CTRL_C) {
        cleanup();
        reject(new Error('Cancelled'));
      } else if (code === CHAR_CODE.BACKSPACE || code === CHAR_CODE.DEL) {
        input = input.slice(0, -1);
      } else {
        input += chunk;
      }
    };

    stdin.on('data', onData);
  });
}

// Prompts for the new password twice (password, confirmation) and returns both. Real terminals
// use the masked raw-mode reader above, asked twice in sequence — a TTY stream never "ends"
// mid-session, so sequential prompts work fine there. Piped/non-interactive stdin (the
// `!isTTY` fallback, mainly for scripting/testing rather than real operator use) is read via
// async iteration collecting exactly two lines instead: readline's promise-based `question()`
// called a second time on an already-fully-drained piped stream hangs forever and never
// resolves — confirmed empirically, not just a suspicion — because the stream had already
// delivered all its buffered data and signaled its end before the second call was even made.
async function promptNewPassword() {
  if (process.stdin.isTTY) {
    const password = await promptPasswordMasked('New password: ');
    const confirmation = await promptPasswordMasked('Confirm new password: ');
    return [password, confirmation];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
    if (lines.length === 2) break;
  }
  rl.close();
  return [lines[0] ?? '', lines[1] ?? ''];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.local === args.remote) {
    console.error('Pass exactly one of --local or --remote.');
    process.exit(1);
  }
  const target = args.local ? '--local' : '--remote';

  const emailClause = args.email ? ` AND u.email = '${escapeSqlString(args.email)}'` : '';
  const owners = runD1Query(
    target,
    `SELECT a.id as accountId, u.id as userId, u.email as email FROM account a JOIN user u ON u.id = a.user_id WHERE a.provider_id = 'credential' AND u.role = 'owner'${emailClause};`,
  );

  if (owners.length === 0) {
    console.error(args.email ? `No owner found with email ${args.email}.` : 'No owner account found.');
    process.exit(1);
  }
  if (owners.length > 1) {
    console.error('More than one owner account matched — pass --email to pick a specific one:');
    for (const owner of owners) console.error(`  ${owner.email}`);
    process.exit(1);
  }

  const owner = owners[0];
  console.log(`Resetting the password for: ${owner.email} (${target.slice(2)})`);

  const [password, confirmation] = await promptNewPassword();
  if (password !== confirmation) {
    console.error('Passwords did not match.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  runD1Statement(
    target,
    `UPDATE account SET password = '${escapeSqlString(passwordHash)}' WHERE id = '${escapeSqlString(owner.accountId)}'; ` +
      `DELETE FROM session WHERE user_id = '${escapeSqlString(owner.userId)}';`,
  );

  console.log('Password reset. Every existing session for this account was signed out.');
  console.log("Consider also regenerating this owner's recovery codes once signed back in.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
