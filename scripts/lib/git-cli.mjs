// Pulls in new CMS code from the "upstream" remote as the first step of `pnpm run update`, so
// that command really is the single, no-git-required step it's meant to be for the common case
// — not "go run git commands yourself, then run this." Every install this can act on has an
// "upstream" remote: a real `git clone` of the template, or one scaffolded via `npm create
// @kenresoft-cms@latest` (packages/create/bin/create-kenresoft-cms.mjs names its own remote
// "upstream" specifically for this). Anything else (a raw zip download, or a remote
// deliberately renamed/removed) has no remote to pull from — skipped with guidance, not a hard
// failure, since update.mjs's later steps (install/migrate/redeploy) are still useful against
// whatever code is already on disk.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { compareVersions, latestReleaseTag, parseVersion } from './versioning.mjs';

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function runGitInherit(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function tryRunGit(args, cwd) {
  try {
    return { ok: true, output: runGit(args, cwd) };
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    return { ok: false, stderr };
  }
}

// Exported for direct unit testing (real temp git repos, no interactive merge needed) — the
// actual regression test for the production incident described where this is called from below.
// Restores wrangler.toml to exactly what `atRef` had it as, folding that restoration into
// whatever commit is currently HEAD (a merge commit made with --no-edit, in the one real caller)
// rather than leaving a second, confusing "undo" commit behind. No-ops (returns false) if the
// file didn't exist at `atRef` at all, or if there's nothing to amend (nothing changed).
export function restoreOwnWranglerToml(repoRoot, atRef) {
  const wranglerTomlPath = join(repoRoot, 'wrangler.toml');
  const snapshot = tryRunGit(['show', `${atRef}:wrangler.toml`], repoRoot);
  if (!snapshot.ok) return false;

  writeFileSync(wranglerTomlPath, snapshot.output);
  runGit(['add', 'wrangler.toml'], repoRoot);
  const status = runGit(['status', '--porcelain', '--', 'wrangler.toml'], repoRoot);
  if (!status.trim()) return false; // already matched — nothing to amend

  // --allow-empty: covers the edge case where the merge commit being amended touched nothing
  // but wrangler.toml (e.g. two installs already in sync except for this one file) — restoring
  // it would otherwise make the amend a no-op diff from the parent, which git refuses without
  // this flag. Confirmed by a real regression test hitting exactly this case.
  runGit(['commit', '--amend', '--no-edit', '--allow-empty'], repoRoot);
  return true;
}

// The CMS version this checkout is on (root package.json), or null if it can't be read.
export function readRootVersion(repoRoot) {
  try {
    const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
    return parseVersion(version) ? version : null;
  } catch {
    return null;
  }
}

// Which ref `pnpm run update` merges — see pullLatestCode's comment for the precedence. Exported
// for unit testing against real temporary repos (git-cli.test.mjs).
export function resolveUpdateTarget(repoRoot, { branch, version } = {}) {
  if (branch) {
    const exists = tryRunGit(['rev-parse', '--verify', `refs/remotes/upstream/${branch}`], repoRoot);
    if (!exists.ok) {
      throw new Error(`upstream/${branch} does not exist — check the branch name (e.g. "main" or "develop").`);
    }
    console.log(`✓ Using explicitly requested branch: upstream/${branch} (unreleased code, not a release)`);
    return { mergeRef: `upstream/${branch}`, label: `upstream/${branch}`, toVersionHint: null };
  }

  if (version) {
    const parsed = parseVersion(version);
    if (!parsed) throw new Error(`"${version}" is not a version like 0.9.1.`);
    const tag = `v${version.replace(/^v/, '')}`;
    if (!tryRunGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`], repoRoot).ok) {
      throw new Error(`There is no release ${tag} — see the Releases page on GitHub for the available versions.`);
    }
    console.log(`✓ Using requested release ${tag}`);
    return { mergeRef: tag, label: tag, toVersionHint: tag.slice(1) };
  }

  const tags = tryRunGit(['tag', '--list', 'v*'], repoRoot);
  const latest = latestReleaseTag(tags.ok ? tags.output.split('\n').map((t) => t.trim()).filter(Boolean) : []);
  if (latest) {
    console.log(`✓ Latest release: ${latest}`);
    return { mergeRef: latest, label: latest, toVersionHint: latest.slice(1) };
  }

  // No releases published yet: follow upstream's actual default branch, as every install did
  // before releases existed. Discovered rather than assumed — the local branch's own name isn't
  // guaranteed to match (a renamed branch, or an install scaffolded before `develop` was the
  // default).
  runGit(['remote', 'set-head', 'upstream', '--auto'], repoRoot);
  const headRef = runGit(['symbolic-ref', 'refs/remotes/upstream/HEAD'], repoRoot).trim();
  const defaultBranch = headRef.replace('refs/remotes/upstream/', '');
  console.log(`Upstream has no releases yet — following its default branch, upstream/${defaultBranch}.`);
  return { mergeRef: `upstream/${defaultBranch}`, label: `upstream/${defaultBranch}`, toVersionHint: null };
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

// What gets merged, in order of precedence:
//   - `branch`: that exact upstream branch — e.g. a test/staging install that deliberately tracks
//     `develop` (unreleased code).
//   - `version`: that release tag (`v0.9.1` or `0.9.1`) — pin an install to a specific release.
//   - neither (every normal install): the newest release tag upstream has (docs/RELEASING.md),
//     so a deployment only ever moves between tested releases, never onto whatever happens to
//     be on `develop` that minute. An upstream with no release tags at all falls back to its
//     default branch, which is how every install worked before releases existed.
// Returns { fromVersion, toVersion } (root package.json before and after, null when there was
// nothing to pull) so the caller can show what the update brought.
//
// `ci`, when true, answers the one-time "unrelated histories" reconciliation prompt below
// automatically instead of asking — required for any unattended run (a deployer's own CI/CD
// pipeline running `pnpm run update`, matching the real report that it was stuck failing every
// run there with no way to answer a y/N prompt on a pipeline with no TTY attached). Without this,
// `confirm()`'s `readline.question()` reads immediate EOF on a non-interactive stdin and resolves
// to an empty answer, which reads as "no" — silently cancelling the update on every single CI
// run, not failing loudly or asking again next time.
export async function pullLatestCode(repoRoot, { branch, version, ci = false } = {}) {
  const nothingPulled = { fromVersion: null, toVersion: null };
  if (!existsSync(join(repoRoot, '.git'))) {
    console.log('Not a git repository — skipping the automatic code pull (deploying whatever is on disk).');
    return nothingPulled;
  }

  const remotes = tryRunGit(['remote'], repoRoot);
  if (!remotes.ok || !remotes.output.split('\n').includes('upstream')) {
    console.log(
      'No "upstream" remote configured — skipping the automatic code pull.\n' +
        '  Add one yourself to enable it: git remote add upstream ' +
        'https://github.com/kenresoft-technologies/kenresoft-cms.git',
    );
    return nothingPulled;
  }

  console.log('Fetching the latest CMS code from upstream...');
  // No refspec — fetches every branch upstream has (git's default refspec for a remote is
  // `+refs/heads/*:refs/remotes/upstream/*`), so both `upstream/main` and `upstream/develop`
  // land locally regardless of which one ends up merged below. --tags adds every release tag.
  runGitInherit(['fetch', '--tags', 'upstream'], repoRoot);

  const fromVersion = readRootVersion(repoRoot);
  const { mergeRef, label, toVersionHint } = resolveUpdateTarget(repoRoot, { branch, version });

  // Already contains the target (up to date, or ahead of it — e.g. an install that tracked
  // `develop` and is now back on releases): nothing to merge. An explicitly requested older
  // release is refused rather than silently doing nothing — merging it can't downgrade, and a
  // real downgrade needs care because database migrations don't run backwards.
  if (tryRunGit(['merge-base', '--is-ancestor', mergeRef, 'HEAD'], repoRoot).ok) {
    if (version && toVersionHint && fromVersion && compareVersions(toVersionHint, fromVersion) < 0) {
      throw new Error(
        `This install is on v${fromVersion}, newer than ${label}. \`pnpm run update\` doesn't downgrade — ` +
          'see "Rolling back" in docs/RELEASING.md.',
      );
    }
    console.log(`✓ Already up to date with ${label}${fromVersion ? ` (running v${fromVersion})` : ''}.`);
    return nothingPulled;
  }

  // Local config edits (wrangler.toml's database_id/CORS_ORIGINS, pnpm-lock.yaml) are always
  // uncommitted, expected local state on a real deployment — stash them out of the way so the
  // merge never has to reconcile a dirty working tree, then restore them after.
  const stashOutput = runGit(['stash', 'push', '-u', '-m', 'pnpm run update: temporary stash'], repoRoot);
  const stashed = !stashOutput.includes('No local changes to save');

  // Snapshot wrangler.toml as this branch had it *committed*, right before the merge touches
  // anything — the unrelated-histories path below needs this to survive a real, confirmed
  // production incident: an operator who (reasonably, per this project's own "prefer small,
  // reviewable commits" convention) committed their real database_id/bucket_name/
  // BETTER_AUTH_URL/custom-domain [[routes]] into wrangler.toml at some point had every one of
  // those values silently overwritten by the generic template's placeholders, because
  // `-X theirs` resolves the *entire file* as one add/add conflict when there's no common
  // ancestor — the confirmation prompt below used to claim wrangler.toml was "safe regardless"
  // on the assumption its only local changes were the stash's uncommitted diff, which is false
  // once any of it was ever committed.
  const preMergeHead = runGit(['rev-parse', 'HEAD'], repoRoot).trim();

  const merge = tryRunGit(['merge', mergeRef, '--no-edit'], repoRoot);
  if (!merge.ok) {
    if (/refusing to merge unrelated histories/i.test(merge.stderr)) {
      // Only true for an install scaffolded before this project's create-tool switched from a
      // tarball + fresh `git init` to a real `git clone` — that fresh init's one throwaway
      // commit shares no ancestry with the real upstream history, so a normal merge is
      // structurally impossible, not just unclean. Confirmed by hand: forcing it through with
      // --allow-unrelated-histories alone still surfaces a spurious "add/add" conflict on every
      // file any upstream commit has touched since scaffold time, even where the content
      // doesn't actually conflict, because there's no common ancestor to 3-way-diff against —
      // -X theirs is what actually resolves those cleanly, at the cost of also discarding any
      // real hand-edits to CMS source, hence asking first rather than doing this silently.
      console.log(
        '\nThis install has no shared git history with the upstream repo yet — it was likely\n' +
          'scaffolded before this tool switched to a real `git clone`. Reconciling it needs a\n' +
          'one-time merge that resolves every conflict in favor of the upstream code, INCLUDING\n' +
          'any hand-edits you made directly to CMS source files. wrangler.toml is protected\n' +
          'separately either way (your uncommitted config edits are already stashed above, and\n' +
          "this install's own *committed* wrangler.toml — database_id, bucket_name,\n" +
          'BETTER_AUTH_URL, any custom-domain routes — is restored verbatim right after this\n' +
          'merge, not overwritten by the incoming template).',
      );
      // Unattended (--ci): there's no one to ask, and re-running gets the same unrelated-
      // histories state every time regardless — proceeding automatically is what makes `pnpm
      // run update` in CI/CD actually converge instead of failing identically forever.
      const proceed = ci ? true : await confirm('Proceed with this one-time reconciliation?');
      if (ci) {
        console.log('--ci given: proceeding with the one-time reconciliation automatically.');
      }
      if (!proceed) {
        if (stashed) runGitInherit(['stash', 'pop'], repoRoot);
        throw new Error('Update cancelled — code was not pulled. Re-run when ready, or pass --ci to skip this prompt.');
      }
      runGitInherit(
        ['merge', mergeRef, '--allow-unrelated-histories', '-X', 'theirs', '--no-edit'],
        repoRoot,
      );

      // -X theirs resolves wrangler.toml the same as every other file — as one whole-file
      // add/add conflict with no common ancestor to 3-way-diff against — so it always wins in
      // favor of the incoming template's placeholders, discarding this deployment's own
      // database_id/bucket_name/BETTER_AUTH_URL/custom-domain routes with no conflict marker to
      // catch by eye. Force this one file back to what this branch had committed immediately
      // before the merge.
      if (restoreOwnWranglerToml(repoRoot, preMergeHead)) {
        console.log(
          "✓ wrangler.toml: kept this install's own values — review it for any new config " +
            'keys the update above may have introduced upstream (new [[ratelimits]]/binding ' +
            'entries, etc.), since this file was deliberately excluded from the merge.',
        );
      }
    } else {
      if (stashed) {
        console.error('(Your local config changes are safely stashed — recover them with `git stash pop` after resolving.)');
      }
      throw new Error(
        `Merging ${label} hit a real conflict:\n${merge.stderr}\n` +
          'Resolve it yourself (git status), commit, then re-run `pnpm run update`.',
      );
    }
  }

  if (stashed) {
    const pop = tryRunGit(['stash', 'pop'], repoRoot);
    if (!pop.ok) {
      throw new Error(
        `Restoring your local config changes hit a conflict:\n${pop.stderr}\n` +
          'Resolve it yourself (git status — your changes are still in the stash either way), then re-run `pnpm run update`.',
      );
    }
  }

  const toVersion = readRootVersion(repoRoot);
  console.log(
    fromVersion && toVersion && fromVersion !== toVersion
      ? `✓ Code updated: v${fromVersion} → v${toVersion}.`
      : `✓ Code updated to ${label}.`,
  );
  return { fromVersion, toVersion };
}
