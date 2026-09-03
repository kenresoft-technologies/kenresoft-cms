#!/usr/bin/env node
// Scaffolds a new Kenresoft CMS install by downloading the current `main` branch of the
// monorepo template directly from GitHub, rather than bundling a snapshot inside this package.
// That means most future CMS improvements reach `npm create @kenresoft-cms@latest` automatically,
// on the next run, with no need to republish this tool at all — only a change to this script's
// own mechanics (the download/extract logic itself) ever needs a version bump here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import { extract } from 'tar';

// Overridable only via env var, not a documented CLI flag — an internal hook for testing this
// script against a fork/branch before a real release, not something an end user needs.
//
// REF defaults to GitHub's special "HEAD" ref, which codeload.github.com resolves to whatever
// the repo's current *default* branch actually is (confirmed empirically — the tarball's content
// matches the default branch, not a hardcoded "main"/"develop" name). That matters concretely
// here: at the time this was written, this repo's default branch was `develop`, not `main` (see
// docs/DEPLOYMENT.md and CLAUDE.md's branch rules) — hardcoding a branch name would have shipped
// a tool that silently scaffolds from the wrong branch the moment that ever changes.
const REPO = process.env.KENRESOFT_CREATE_REPO ?? 'kenresoft-technologies/kenresoft-cms';
const REF = process.env.KENRESOFT_CREATE_REF ?? 'HEAD';
const TARBALL_URL = `https://codeload.github.com/${REPO}/tar.gz/${REF}`;

async function main() {
  const targetArg = process.argv[2];
  const target = path.resolve(targetArg ?? '.');

  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`"${target}" already exists and is not empty.`);
    console.error('Pass a new directory name, e.g.: npm create @kenresoft-cms@latest my-cms');
    process.exitCode = 1;
    return;
  }
  mkdirSync(target, { recursive: true });

  console.log(`Downloading Kenresoft CMS (${REPO}@${REF}) into ${targetArg ?? '.'} ...`);
  const response = await fetch(TARBALL_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${TARBALL_URL}: ${response.status} ${response.statusText}`);
  }

  // GitHub's tarball wraps everything in one top-level "<repo>-<branch>/" directory — strip it
  // so the template's own files land directly in `target`, the same shape `git clone` gives you.
  await pipeline(Readable.fromWeb(response.body), createGunzip(), extract({ cwd: target, strip: 1 }));

  // The downloaded tarball never contains a .git directory, but remove it defensively in case a
  // future packaging change on GitHub's end ever includes one — this must always be a fresh repo.
  rmSync(path.join(target, '.git'), { recursive: true, force: true });
  let gitReady = false;
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: target, stdio: 'ignore' });
    // Points back at the real template so a later `git fetch upstream && git merge
    // upstream/<branch>` can actually pull in future CMS updates — without this remote, a
    // scaffolded install has no way to receive updates at all beyond re-scaffolding from scratch.
    // Named "upstream" (not "origin") since the user's own eventual remote belongs at "origin".
    execFileSync('git', ['remote', 'add', 'upstream', `https://github.com/${REPO}.git`], {
      cwd: target,
      stdio: 'ignore',
    });
    // An initial commit gives that future merge real history to diff against — merging into a
    // freshly-`git init`'d repo with zero commits has nothing to compare against. Wrapped
    // separately from `init`/`remote add` above: this step alone fails if the user has no git
    // identity (user.name/user.email) configured yet, which shouldn't block scaffolding.
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'ignore' });
    execFileSync(
      'git',
      ['commit', '--quiet', '-m', `Initial commit from Kenresoft CMS (${REPO}@${REF})`],
      { cwd: target, stdio: 'ignore' },
    );
    gitReady = true;
  } catch {
    console.warn(
      '(git init/commit step failed or git is not on PATH — every file is there regardless; ' +
        'see the README for setting up git manually if you want upstream updates later.)',
    );
  }

  console.log('\nDone! Next steps:\n');
  if (targetArg) console.log(`  cd ${targetArg}`);
  console.log('  pnpm install');
  console.log('  pnpm run setup');
  console.log(
    '\nSee https://github.com/kenresoft-technologies/kenresoft-cms#readme for what that provisions.',
  );
  if (gitReady) {
    console.log(
      '\nTo pull in future CMS updates later: git fetch upstream && git merge upstream/' +
        (REF === 'HEAD' ? '<branch>' : REF) +
        ' — see docs/DEPLOYMENT.md\'s "Updating an existing install" section.',
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
