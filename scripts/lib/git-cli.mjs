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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

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

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export async function pullLatestCode(repoRoot) {
  if (!existsSync(join(repoRoot, '.git'))) {
    console.log('Not a git repository — skipping the automatic code pull (deploying whatever is on disk).');
    return;
  }

  const remotes = tryRunGit(['remote'], repoRoot);
  if (!remotes.ok || !remotes.output.split('\n').includes('upstream')) {
    console.log(
      'No "upstream" remote configured — skipping the automatic code pull.\n' +
        '  Add one yourself to enable it: git remote add upstream ' +
        'https://github.com/kenresoft-technologies/kenresoft-cms.git',
    );
    return;
  }

  console.log('Fetching the latest CMS code from upstream...');
  runGitInherit(['fetch', 'upstream'], repoRoot);

  // Discover upstream's actual default branch rather than assuming the local branch's own name
  // matches it — true for a fresh `git clone`-based scaffold, not guaranteed for an older
  // install (e.g. one whose local branch got renamed, or scaffolded before this repo's default
  // branch was `develop`).
  runGit(['remote', 'set-head', 'upstream', '--auto'], repoRoot);
  const headRef = runGit(['symbolic-ref', 'refs/remotes/upstream/HEAD'], repoRoot).trim();
  const defaultBranch = headRef.replace('refs/remotes/upstream/', '');

  // Local config edits (wrangler.toml's database_id/CORS_ORIGINS, pnpm-lock.yaml) are always
  // uncommitted, expected local state on a real deployment — stash them out of the way so the
  // merge never has to reconcile a dirty working tree, then restore them after.
  const stashOutput = runGit(['stash', 'push', '-u', '-m', 'pnpm run update: temporary stash'], repoRoot);
  const stashed = !stashOutput.includes('No local changes to save');

  const merge = tryRunGit(['merge', `upstream/${defaultBranch}`, '--no-edit'], repoRoot);
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
          'any hand-edits you made directly to CMS source files (your wrangler.toml/config\n' +
          'changes are safe regardless — already set aside above).',
      );
      const proceed = await confirm('Proceed with this one-time reconciliation?');
      if (!proceed) {
        if (stashed) runGitInherit(['stash', 'pop'], repoRoot);
        throw new Error('Update cancelled — code was not pulled. Re-run when ready.');
      }
      runGitInherit(
        ['merge', `upstream/${defaultBranch}`, '--allow-unrelated-histories', '-X', 'theirs', '--no-edit'],
        repoRoot,
      );
    } else {
      if (stashed) {
        console.error('(Your local config changes are safely stashed — recover them with `git stash pop` after resolving.)');
      }
      throw new Error(
        `Merging upstream/${defaultBranch} hit a real conflict:\n${merge.stderr}\n` +
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

  console.log('✓ Code updated.');
}
