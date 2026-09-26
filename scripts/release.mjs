#!/usr/bin/env node
// Cuts a Kenresoft CMS release: `pnpm run release -- <patch|minor|major|X.Y.Z> [--dry-run] [--yes]`.
// Maintainers only — deployers never run this; they run `pnpm run update`, which follows the
// release tags this creates. The full process and the semver rules are in docs/RELEASING.md.
//
// From a clean, up-to-date `develop`, it:
//   1. bumps the version in the root, apps/api and apps/admin package.json (one version for the
//      whole CMS; the published npm packages keep their own),
//   2. moves CHANGELOG.md's "## Unreleased" into a dated "## [X.Y.Z] - YYYY-MM-DD" section,
//   3. commits "release: vX.Y.Z" and creates the annotated tag vX.Y.Z,
//   4. pushes develop and the tag, creates the GitHub release (notes = that CHANGELOG section),
//   5. opens (or points at) the develop → main pull request.
// Nothing is pushed before you confirm, and --dry-run changes nothing at all.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closePrompt, confirm } from './lib/prompt.mjs';
import { changelogSection, nextVersion, parseVersion, rotateChangelog } from './lib/versioning.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_BRANCH = 'develop';
const VERSIONED_PACKAGES = ['package.json', 'apps/api/package.json', 'apps/admin/package.json'];

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
}

function tryRun(command, args) {
  try {
    return { ok: true, output: run(command, args).trim() };
  } catch (error) {
    return { ok: false, output: String(error?.stderr ?? error?.message ?? '') };
  }
}

// Read files as LF (a Windows checkout with core.autocrlf may have CRLF) and write them back in
// whatever line ending they had.
function readText(path) {
  const raw = readFileSync(join(REPO_ROOT, path), 'utf8');
  return { text: raw.replace(/\r\n/g, '\n'), crlf: raw.includes('\r\n') };
}

function writeText(path, { text, crlf }) {
  writeFileSync(join(REPO_ROOT, path), crlf ? text.replace(/\n/g, '\r\n') : text);
}

// Replaces only the top-level "version" field, keeping the file's own formatting.
function setPackageVersion(text, version) {
  const updated = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if (updated === text && !text.includes(`"version": "${version}"`)) {
    throw new Error('Could not find a "version" field to update.');
  }
  return updated;
}

function parseArgs(rawArgv) {
  // pnpm passes the `--` separator from `pnpm run release -- minor` through literally.
  const argv = rawArgv.filter((arg) => arg !== '--');
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const unknown = [...flags].filter((flag) => !['--dry-run', '--yes'].includes(flag));
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(', ')}.`);
  if (positional.length !== 1) {
    throw new Error('Usage: pnpm run release -- <patch|minor|major|X.Y.Z> [--dry-run] [--yes]');
  }
  return { kind: positional[0], dryRun: flags.has('--dry-run'), yes: flags.has('--yes') };
}

function preflight() {
  const problems = [];
  const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.output !== RELEASE_BRANCH) problems.push(`Releases are cut from ${RELEASE_BRANCH}; you're on "${branch.output}".`);
  if (tryRun('git', ['status', '--porcelain']).output) problems.push('The working tree has uncommitted changes.');
  if (!tryRun('git', ['fetch', '--tags', 'origin', RELEASE_BRANCH]).ok) {
    problems.push(`Could not fetch origin/${RELEASE_BRANCH}.`);
  } else {
    const counts = tryRun('git', ['rev-list', '--left-right', '--count', `HEAD...origin/${RELEASE_BRANCH}`]).output;
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    if (behind > 0) problems.push(`Your ${RELEASE_BRANCH} is ${behind} commit(s) behind origin — pull first.`);
    if (ahead > 0) problems.push(`Your ${RELEASE_BRANCH} has ${ahead} unpushed commit(s) — push or drop them first.`);
  }
  if (!tryRun('gh', ['auth', 'status']).ok) problems.push('The GitHub CLI is not signed in (run `gh auth login`).');
  return problems;
}

async function main() {
  const { kind, dryRun, yes } = parseArgs(process.argv.slice(2));
  const root = JSON.parse(readText('package.json').text);
  const current = root.version;
  if (!parseVersion(current)) throw new Error(`package.json's version "${current}" is not valid semver.`);
  const version = nextVersion(current, kind);
  const tag = `v${version}`;
  const date = new Date().toISOString().slice(0, 10);

  const changelog = readText('CHANGELOG.md');
  const rotated = rotateChangelog(changelog.text, version, date);
  const notes = changelogSection(rotated, version);

  console.log(`Kenresoft CMS release: v${current} → ${tag} (${date})\n`);
  console.log('Release notes (from CHANGELOG.md "## Unreleased"):\n');
  console.log(notes.split('\n').map((line) => `  ${line}`).join('\n'));
  console.log('');

  const problems = preflight();
  if (tryRun('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).ok) problems.push(`Tag ${tag} already exists.`);
  if (problems.length > 0) {
    const message = `Can't release yet:\n${problems.map((p) => `  - ${p}`).join('\n')}`;
    if (!dryRun) throw new Error(message);
    console.log(`(dry run) ${message}\n`);
  }

  if (dryRun) {
    console.log(`(dry run) Would bump ${VERSIONED_PACKAGES.join(', ')} to ${version}, date CHANGELOG.md,`);
    console.log(`commit "release: ${tag}", tag ${tag}, push ${RELEASE_BRANCH} and the tag, create the GitHub`);
    console.log(`release, and open the ${RELEASE_BRANCH} → main pull request. Nothing was changed.`);
    return;
  }

  if (!yes && !(await confirm(`Release ${tag} and push it to origin?`, false))) {
    console.log('Cancelled. Nothing was changed.');
    return;
  }

  for (const path of VERSIONED_PACKAGES) {
    const file = readText(path);
    writeText(path, { ...file, text: setPackageVersion(file.text, version) });
  }
  writeText('CHANGELOG.md', { ...changelog, text: rotated });

  run('git', ['add', ...VERSIONED_PACKAGES, 'CHANGELOG.md']);
  run('git', ['commit', '-m', `release: ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', `Kenresoft CMS ${tag}`]);
  console.log(`✓ Committed and tagged ${tag} locally.`);

  // Branch first, then the tag, so the tag never points at a commit origin doesn't have.
  run('git', ['push', 'origin', RELEASE_BRANCH], { stdio: 'inherit' });
  run('git', ['push', 'origin', tag], { stdio: 'inherit' });
  console.log(`✓ Pushed ${RELEASE_BRANCH} and ${tag}.`);

  const notesDir = mkdtempSync(join(tmpdir(), 'kenresoft-release-'));
  const notesFile = join(notesDir, 'notes.md');
  writeFileSync(notesFile, `${notes}\n`);
  try {
    run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesFile, '--verify-tag', '--latest']);
    console.log(`✓ Created the GitHub release ${tag}.`);
  } catch (error) {
    console.error(
      `\nThe tag is pushed, but creating the GitHub release failed:\n${error?.stderr ?? error}\n` +
        `Create it by hand: gh release create ${tag} --title ${tag} --notes-file <notes> --verify-tag`,
    );
    process.exitCode = 1;
  } finally {
    rmSync(notesDir, { recursive: true, force: true });
  }

  const existingPr = tryRun('gh', ['pr', 'list', '--base', 'main', '--head', RELEASE_BRANCH, '--state', 'open', '--json', 'url', '-q', '.[0].url']);
  if (existingPr.ok && existingPr.output) {
    console.log(`✓ ${RELEASE_BRANCH} → main is already open: ${existingPr.output}`);
  } else {
    const pr = tryRun('gh', [
      'pr', 'create', '--base', 'main', '--head', RELEASE_BRANCH, '--title', `Release ${tag}`,
      '--body', `Brings main up to ${tag}. Release notes: https://github.com/kenresoft-technologies/kenresoft-cms/releases/tag/${tag}`,
    ]);
    console.log(pr.ok ? `✓ Opened ${RELEASE_BRANCH} → main: ${pr.output}` : `Open the ${RELEASE_BRANCH} → main pull request by hand:\n${pr.output}`);
  }

  console.log(`\nDone. Deployers get ${tag} with \`pnpm run update\`.`);
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePrompt);
