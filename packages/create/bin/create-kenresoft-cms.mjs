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
  try {
    execFileSync('git', ['init'], { cwd: target, stdio: 'ignore' });
  } catch {
    console.warn('(git not found on PATH — skipped `git init`; every file is there regardless.)');
  }

  console.log('\nDone! Next steps:\n');
  if (targetArg) console.log(`  cd ${targetArg}`);
  console.log('  pnpm install');
  console.log('  pnpm run setup');
  console.log(
    '\nSee https://github.com/kenresoft-technologies/kenresoft-cms#readme for what that provisions.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
