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
//
// `--astro` is a separate, much smaller mode: scaffolding just an Astro frontend (this package's
// own bundled `templates/astro-starter`, not a clone of the CMS monorepo) for someone who
// already has a Kenresoft CMS deployment and only wants a site to read from it. Deliberately NOT
// git-history-shared with anything — it's a one-time template copy, not an ongoing-update
// relationship, the same category as `npm create astro@latest`'s own starters. See
// docs/ASTRO.md's "Connecting your own, separately-hosted Astro project" section in the CMS repo.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Overridable only via env var, not a documented CLI flag — an internal hook for testing this
// script against a fork/branch before a real release, not something an end user needs.
const REPO = process.env.KENRESOFT_CREATE_REPO ?? 'kenresoft-technologies/kenresoft-cms';
// 'HEAD' (the default) is passed straight to `git clone` with no `--branch` flag at all, which
// checks out the repo's actual current default branch automatically — no need to hardcode or
// separately resolve one.
const REF = process.env.KENRESOFT_CREATE_REF ?? 'HEAD';
const REPO_URL = `https://github.com/${REPO}.git`;

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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

function parseArgs(argv) {
  let astro = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === '--astro') astro = true;
    else if (arg.startsWith('--')) {
      console.error(`Unknown argument: ${arg}`);
      process.exitCode = 1;
      process.exit(1);
    } else positional.push(arg);
  }
  return { astro, targetArg: positional[0] };
}

function ensureEmptyTarget(target) {
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`"${target}" already exists and is not empty.`);
    console.error('Pass a new directory name, e.g.: npm create @kenresoft-cms@latest my-cms');
    process.exitCode = 1;
    return false;
  }
  return true;
}

// Best-effort — falls back to the version pinned in the bundled template's own package.json
// (kept reasonably current, but this is what keeps a scaffold correct even fully offline or if
// the registry is unreachable, same resilience convention this codebase uses for CMS-content
// fetches elsewhere: never let a non-critical network call hard-fail the whole operation).
async function fetchLatestAstroClientVersion() {
  try {
    const response = await fetch('https://registry.npmjs.org/@kenresoft-cms/astro/latest');
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

function sanitizePackageName(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'my-kenresoft-cms-site';
}

async function scaffoldAstroStarter(target, targetArg) {
  if (!ensureEmptyTarget(target)) return;

  const templateDir = join(PACKAGE_ROOT, 'templates', 'astro-starter');
  console.log(`Scaffolding a Kenresoft CMS Astro starter into ${targetArg ?? '.'} ...`);
  cpSync(templateDir, target, { recursive: true });

  // npm/pnpm always strip a literal `.gitignore` from a published package (same reason
  // create-vite/create-react-app-style tools ship one named `_gitignore` instead) — the
  // template keeps it as `_gitignore` on disk for exactly that reason, renamed back here.
  const gitignorePath = join(target, '_gitignore');
  if (existsSync(gitignorePath)) renameSync(gitignorePath, join(target, '.gitignore'));

  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = sanitizePackageName(targetArg ?? 'my-kenresoft-cms-site');

  const latestVersion = await fetchLatestAstroClientVersion();
  if (latestVersion) pkg.dependencies['@kenresoft-cms/astro'] = `^${latestVersion}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // A fresh, standalone repo — deliberately not `git clone`d/history-shared with anything.
  // Unlike the full CMS scaffold above, there's no `pnpm run update`-style ongoing-merge
  // relationship for this starter; it's a one-time copy you customize from there, the same as
  // any other framework starter template.
  try {
    execFileSync('git', ['init'], { cwd: target, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'Scaffold: Kenresoft CMS Astro starter', '--quiet'], {
      cwd: target,
      stdio: 'ignore',
    });
  } catch {
    // git isn't required for this mode (no shared history to set up) — a missing/misconfigured
    // git (e.g. no user.name/user.email set yet) shouldn't fail the whole scaffold over it.
  }

  console.log('\nDone! Next steps:\n');
  if (targetArg) console.log(`  cd ${targetArg}`);
  console.log('  cp .env.example .env   # set PUBLIC_KENRESOFT_CMS_URL to your CMS deployment');
  console.log('  pnpm install   (or npm/yarn)');
  console.log('  pnpm dev');
  console.log(
    "\nSee this project's own README.md for what to change first (the placeholder content " +
      'type/form slugs), and the Kenresoft CMS repo\'s docs/ASTRO.md for everything the client ' +
      'supports beyond this starting point:\n' +
      'https://github.com/kenresoft-technologies/kenresoft-cms/blob/main/docs/ASTRO.md',
  );
}

async function scaffoldFullCms(target, targetArg) {
  if (!ensureEmptyTarget(target)) return;

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

async function main() {
  const { astro, targetArg } = parseArgs(process.argv.slice(2));
  // resolve(), not join() — join() has no special handling for an already-absolute targetArg
  // and would concatenate it onto cwd instead (e.g. `npm create ... C:\Users\me\site` became
  // `<cwd>\C:\Users\me\site`), breaking scaffolding to an absolute path.
  const target = resolve(process.cwd(), targetArg ?? '.');

  if (astro) await scaffoldAstroStarter(target, targetArg);
  else await scaffoldFullCms(target, targetArg);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
