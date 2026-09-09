// Shared wrangler-invocation helper for scripts/setup.mjs. Deliberately not also used by
// apps/api/scripts/recover-owner.mjs or backup-media.mjs — those already work and ship today;
// retrofitting them to import a root-level module purely for symmetry would add regression risk
// to already-shipped recovery/backup tooling for no user-facing benefit. Whoever next touches
// either of those two is the natural point to fold them into this module instead.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Invoked as a plain Node script rather than through pnpm/npx — those resolve to a .CMD shell
// wrapper on Windows, which execFileSync can't run without shell:true. wrangler's package.json
// "exports" doesn't expose ./bin/wrangler.js as an importable subpath (it's meant to be run via
// its `bin` field, not required), so resolve the package root instead and join the known bin
// path onto it rather than resolving the script file directly. Requires `wrangler` to be a
// devDependency of the caller's own package.json (or hoisted to it) — see root package.json.
export const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

export function runWrangler(args, options = {}) {
  return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    // stdio[0] must be 'pipe', not 'ignore', whenever `options.input` is set (e.g. `secret put`
    // piping a value in) — confirmed empirically, the hard way: execFileSync does NOT let
    // `input` override an explicitly-'ignore'd stdio[0] the way its docs read. With 'ignore'
    // there, `input` is silently delivered as an empty string instead of erroring, which is
    // exactly how ensureAuthSecret()/reassertAuthSecret() ended up setting BETTER_AUTH_SECRET to
    // "" on a real deployment — wrangler happily reports success, `secret list` shows it
    // configured, and better-auth still throws "you are using the default secret" at request
    // time, because an empty string is falsy. 'pipe' is safe unconditionally: without `input`,
    // an unwritten pipe behaves the same as 'ignore' for a command that never reads stdin.
    stdio: ['pipe', 'pipe', 'inherit'],
    ...options,
  });
}

// For commands whose stdout we don't need to parse (deploys, secret puts) but whose progress
// output the operator should still see live, rather than buffered until the process exits.
export function runWranglerInherit(args, options = {}) {
  execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    stdio: 'inherit',
    ...options,
  });
}
