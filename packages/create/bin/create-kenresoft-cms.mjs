#!/usr/bin/env node
// Scaffolds a new Kenresoft CMS install via a real `git clone` of the monorepo template,
// rather than a tarball download + fresh `git init` (the original approach). A real clone
// shares actual commit history with the upstream repo, which is what lets a later `pnpm run
// update` (which itself runs `git fetch upstream && git merge upstream/<branch>` — see
// scripts/lib/git-cli.mjs) do a normal, low-conflict merge instead of every file touched by any
// upstream commit since scaffold time coming back as a conflict with no common ancestor to
// reconcile against. Confirmed the hard way against a real tarball-scaffolded install: its
// first real update attempt hit git's "refusing to merge unrelated histories", and even forcing
// that through surfaced a spurious "add/add" conflict on every such file regardless of whether
// its content had actually diverged.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Overridable only via env var, not a documented CLI flag — an internal hook for testing this
// script against a fork/branch before a real release, not something an end user needs.
const REPO = process.env.KENRESOFT_CREATE_REPO ?? 'kenresoft-technologies/kenresoft-cms';
// 'HEAD' (the default) is passed straight to `git clone` with no `--branch` flag at all, which
// checks out the repo's actual current default branch automatically — no need to hardcode or
// separately resolve one.
const REF = process.env.KENRESOFT_CREATE_REF ?? 'HEAD';
const REPO_URL = `https://github.com/${REPO}.git`;

function ensureGitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'git is required to scaffold a new install (a real clone is what makes future ' +
        '`pnpm run update` pulls work cleanly) — install git and try again.',
    );
  }
}

async function main() {
  const targetArg = process.argv[2];
  const target = path.resolve(targetArg ?? '.');

  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`"${target}" already exists and is not empty.`);
    console.error('Pass a new directory name, e.g.: npm create @kenresoft-cms@latest my-cms');
    process.exitCode = 1;
    return;
  }

  ensureGitAvailable();

  console.log(`Cloning Kenresoft CMS (${REPO}${REF === 'HEAD' ? '' : `@${REF}`}) into ${targetArg ?? '.'} ...`);
  // Named "upstream" (not "origin") from the start — the user's own eventual remote (if they
  // push this to their own GitHub repo) belongs at "origin"; "upstream" is what `pnpm run
  // update` looks for when pulling in future CMS changes. Full clone, not `--depth 1`: a
  // shallow clone's boundary commit is still real and shared with upstream, so merges would
  // still work, but a full history sidesteps shallow-clone edge cases in less common git
  // operations without meaningfully affecting a repo this size.
  const cloneArgs = ['clone', '--origin', 'upstream'];
  if (REF !== 'HEAD') cloneArgs.push('--branch', REF);
  cloneArgs.push(REPO_URL, target);
  execFileSync('git', cloneArgs, { stdio: 'inherit' });

  console.log('\nDone! Next steps:\n');
  if (targetArg) console.log(`  cd ${targetArg}`);
  console.log('  pnpm install');
  console.log('  pnpm run setup');
  console.log(
    '\nSee https://github.com/kenresoft-technologies/kenresoft-cms#readme for what that provisions.',
  );
  console.log(
    '\nTo pull in future CMS updates later, just run: pnpm run update — it fetches and merges ' +
      'the latest\nupstream code automatically before redeploying. See docs/DEPLOYMENT.md\'s ' +
      '"Updating an existing install" section.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
