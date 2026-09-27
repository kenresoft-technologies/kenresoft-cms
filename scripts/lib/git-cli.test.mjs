import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pullLatestCode, restoreOwnWranglerToml } from './git-cli.mjs';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-git-cli-'));
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 'test@example.test'], dir);
  git(['config', 'user.name', 'Test'], dir);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function commitWranglerToml(dir, content, message) {
  writeFileSync(join(dir, 'wrangler.toml'), content);
  git(['add', 'wrangler.toml'], dir);
  git(['commit', '--quiet', '-m', message], dir);
}

// Direct regression test for a real report: `pnpm run update` run unattended (a deployer's own
// CI/CD pipeline, no TTY) hit the unrelated-histories reconciliation prompt and was cancelled on
// every single run, with no way to answer a y/N question non-interactively. `ci: true` must
// resolve it automatically and never touch stdin at all — this test provides no stdin/TTY of its
// own, so it would hang or throw if `confirm()` were reached despite `ci: true`.
test('pullLatestCode with ci:true resolves the unrelated-histories reconciliation without prompting', async () => {
  const upstream = makeRepo();
  const clone = makeRepo();
  try {
    // A real, explicitly-named default branch on the "upstream" side, so `remote set-head
    // --auto` has something unambiguous to discover regardless of this machine's own
    // init.defaultBranch config.
    git(['checkout', '-b', 'main'], upstream.dir);
    commitWranglerToml(upstream.dir, 'name = "kenresoft-cms-api"\ndatabase_id = "REPLACE_ME"\n', 'upstream initial');
    writeFileSync(join(upstream.dir, 'README.md'), '# upstream\n');
    git(['add', 'README.md'], upstream.dir);
    git(['commit', '--quiet', '-m', 'add readme'], upstream.dir);

    // The clone: a fresh, unrelated init — exactly what packages/create used to produce before
    // it switched to a real `git clone`, sharing no ancestry with upstream at all.
    git(['checkout', '-b', 'main'], clone.dir);
    commitWranglerToml(
      clone.dir,
      'name = "my-real-deployment"\ndatabase_id = "97a150b1-e60e-4652-9e5a-a561ffb8459e"\n',
      'scaffold init',
    );
    git(['remote', 'add', 'upstream', upstream.dir], clone.dir);

    await pullLatestCode(clone.dir, { ci: true });

    // The merge actually ran (upstream's own file landed), it wasn't just skipped.
    assert.ok(existsSync(join(clone.dir, 'README.md')));
    // And this install's own committed wrangler.toml values survived it intact.
    const content = readFileSync(join(clone.dir, 'wrangler.toml'), 'utf8');
    assert.match(content, /my-real-deployment/);
    assert.match(content, /97a150b1-e60e-4652-9e5a-a561ffb8459e/);
  } finally {
    upstream.cleanup();
    clone.cleanup();
  }
});

// Direct regression test for the real production incident described in the field report: a
// -X theirs merge resolving wrangler.toml as a whole-file add/add conflict silently replaces a
// live deployment's real database_id/bucket_name/BETTER_AUTH_URL with the generic template's
// placeholders, with no conflict marker anywhere to catch it. restoreOwnWranglerToml is what
// pullLatestCode calls right after that merge to undo exactly this.
test('restoreOwnWranglerToml puts back the pre-merge committed content and amends it into HEAD', () => {
  const repo = makeRepo();
  try {
    commitWranglerToml(
      repo.dir,
      'name = "pathveragroup-website-api"\ndatabase_id = "97a150b1-e60e-4652-9e5a-a561ffb8459e"\n',
      'real deployment config',
    );
    const preMergeHead = git(['rev-parse', 'HEAD'], repo.dir).trim();

    // Simulate what a -X theirs merge does to this file: overwrite it with the incoming
    // template's placeholders, then commit (standing in for the merge's own auto-commit).
    commitWranglerToml(
      repo.dir,
      'name = "kenresoft-cms-api"\ndatabase_id = "REPLACE_ME"\n',
      'simulated -X theirs merge commit',
    );

    const restored = restoreOwnWranglerToml(repo.dir, preMergeHead);
    assert.equal(restored, true);

    const content = readFileSync(join(repo.dir, 'wrangler.toml'), 'utf8');
    assert.match(content, /pathveragroup-website-api/);
    assert.match(content, /97a150b1-e60e-4652-9e5a-a561ffb8459e/);
    assert.doesNotMatch(content, /REPLACE_ME/);

    // Folded into HEAD via --amend, not left as an extra "undo" commit or an uncommitted change.
    assert.equal(git(['status', '--porcelain'], repo.dir).trim(), '');
    const log = git(['log', '--oneline'], repo.dir);
    assert.equal(log.trim().split('\n').length, 2, 'expected exactly the original commit plus the amended merge commit');
  } finally {
    repo.cleanup();
  }
});

test('restoreOwnWranglerToml is a no-op when the working copy already matches the pre-merge content', () => {
  const repo = makeRepo();
  try {
    commitWranglerToml(repo.dir, 'name = "same"\n', 'initial');
    const head = git(['rev-parse', 'HEAD'], repo.dir).trim();

    const restored = restoreOwnWranglerToml(repo.dir, head);
    assert.equal(restored, false);
    assert.equal(git(['log', '--oneline'], repo.dir).trim().split('\n').length, 1);
  } finally {
    repo.cleanup();
  }
});

test('restoreOwnWranglerToml returns false when wrangler.toml did not exist at the given ref', () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, 'README.md'), '# hello\n');
    git(['add', 'README.md'], repo.dir);
    git(['commit', '--quiet', '-m', 'no wrangler.toml here'], repo.dir);
    const head = git(['rev-parse', 'HEAD'], repo.dir).trim();

    assert.equal(restoreOwnWranglerToml(repo.dir, head), false);
  } finally {
    repo.cleanup();
  }
});

// --- Release tags (docs/RELEASING.md) -------------------------------------------------------

function commitVersion(dir, version, extraFile) {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'kenresoft-cms', version }, null, 2)}\n`);
  git(['add', 'package.json'], dir);
  if (extraFile) {
    writeFileSync(join(dir, extraFile), 'x\n');
    git(['add', extraFile], dir);
  }
  git(['commit', '--quiet', '-m', `at ${version}`], dir);
}

// An upstream on `develop` with v0.9.0 released, cloned (real shared history, remote named
// "upstream", like packages/create does); then upstream releases v0.9.1 and keeps going with an
// unreleased commit on top.
function releasedUpstreamAndClone() {
  const upstream = makeRepo();
  git(['checkout', '--quiet', '-b', 'develop'], upstream.dir);
  commitVersion(upstream.dir, '0.9.0');
  git(['tag', '-a', 'v0.9.0', '-m', 'v0.9.0'], upstream.dir);

  const parent = mkdtempSync(join(tmpdir(), 'kenresoft-git-cli-clone-'));
  const cloneDir = join(parent, 'clone');
  git(['clone', '--quiet', '--origin', 'upstream', upstream.dir, cloneDir], parent);
  git(['config', 'user.email', 'test@example.test'], cloneDir);
  git(['config', 'user.name', 'Test'], cloneDir);

  commitVersion(upstream.dir, '0.9.1', 'released.txt');
  git(['tag', '-a', 'v0.9.1', '-m', 'v0.9.1'], upstream.dir);
  commitVersion(upstream.dir, '0.9.1', 'unreleased.txt');

  return {
    upstreamDir: upstream.dir,
    cloneDir,
    cleanup: () => {
      upstream.cleanup();
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

test('pullLatestCode follows the latest release tag, never the unreleased tip of develop', async () => {
  const repos = releasedUpstreamAndClone();
  try {
    const result = await pullLatestCode(repos.cloneDir, { ci: true });
    assert.deepEqual(result, { fromVersion: '0.9.0', toVersion: '0.9.1' });
    assert.ok(existsSync(join(repos.cloneDir, 'released.txt')));
    assert.ok(!existsSync(join(repos.cloneDir, 'unreleased.txt')), 'unreleased develop code must not be pulled');

    // Running it again has nothing to do.
    assert.deepEqual(await pullLatestCode(repos.cloneDir, { ci: true }), { fromVersion: null, toVersion: null });
  } finally {
    repos.cleanup();
  }
});

test('pullLatestCode can pin a release, refuses to downgrade, and still follows a branch on request', async () => {
  const repos = releasedUpstreamAndClone();
  try {
    await assert.rejects(pullLatestCode(repos.cloneDir, { version: '0.8.0', ci: true }), /no release v0\.8\.0/);

    assert.deepEqual(await pullLatestCode(repos.cloneDir, { version: 'v0.9.1', ci: true }), {
      fromVersion: '0.9.0',
      toVersion: '0.9.1',
    });
    await assert.rejects(pullLatestCode(repos.cloneDir, { version: '0.9.0', ci: true }), /doesn't downgrade/);

    await pullLatestCode(repos.cloneDir, { branch: 'develop', ci: true });
    assert.ok(existsSync(join(repos.cloneDir, 'unreleased.txt')), '--branch develop pulls unreleased code');
  } finally {
    repos.cleanup();
  }
});

test('pullLatestCode falls back to the default branch when upstream has no releases yet', async () => {
  const repos = releasedUpstreamAndClone();
  try {
    for (const tag of ['v0.9.0', 'v0.9.1']) git(['tag', '-d', tag], repos.upstreamDir);
    // The clone was made before v0.9.1 existed, so it only has v0.9.0 locally.
    git(['tag', '-d', 'v0.9.0'], repos.cloneDir);
    await pullLatestCode(repos.cloneDir, { ci: true });
    assert.ok(existsSync(join(repos.cloneDir, 'unreleased.txt')));
  } finally {
    repos.cleanup();
  }
});
