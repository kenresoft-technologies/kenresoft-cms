import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_PACKAGE, MIN_ASTRO_MAJOR, parseVersion, rangeFloor } from './versions.mjs';

const CONFIG_NAMES = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts', 'astro.config.cjs'];
const WRANGLER_NAMES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function detectPackageManager(cwd, pkg) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  const declared = String(pkg?.packageManager ?? '').split('@')[0];
  return ['pnpm', 'yarn', 'bun', 'npm'].includes(declared) ? declared : 'npm';
}

function allDeps(pkg) {
  return { ...pkg?.devDependencies, ...pkg?.dependencies };
}

// Installed version comes from node_modules when present (the truth), else the floor of the
// declared range (a best effort — a lockfile-only checkout has no node_modules yet).
function installedVersion(cwd, name, pkg) {
  const installed = readJson(join(cwd, 'node_modules', ...name.split('/'), 'package.json'))?.version;
  if (parseVersion(installed)) return installed;
  return rangeFloor(allDeps(pkg)[name]);
}

/**
 * Read-only inspection of a directory. Never throws for "not an Astro project" — returns
 * `problems` instead so the caller can report them uniformly.
 */
export function detectProject(cwd) {
  const problems = [];
  const pkgPath = join(cwd, 'package.json');
  const pkg = readJson(pkgPath);
  if (!pkg) {
    return {
      cwd,
      isAstro: false,
      problems: ['No readable package.json here — run this from the root of your Astro project.'],
    };
  }
  const deps = allDeps(pkg);
  const isAstro = typeof deps.astro === 'string';
  if (!isAstro) problems.push('This does not look like an Astro project (no "astro" dependency in package.json).');

  const astroVersion = isAstro ? installedVersion(cwd, 'astro', pkg) : null;
  const astroMajor = parseVersion(astroVersion)?.major ?? null;
  if (isAstro && astroMajor !== null && astroMajor < MIN_ASTRO_MAJOR) {
    problems.push(
      `Astro ${astroVersion} is not supported — @kenresoft-cms/astro needs Astro ${MIN_ASTRO_MAJOR} or newer.`,
    );
  }

  const configName = CONFIG_NAMES.find((n) => existsSync(join(cwd, n))) ?? null;
  const configText = configName ? readText(join(cwd, configName)) : null;
  const wranglerName = WRANGLER_NAMES.find((n) => existsSync(join(cwd, n))) ?? null;
  const wranglerText = wranglerName ? readText(join(cwd, wranglerName)) : null;

  return {
    cwd,
    pkg,
    pkgPath,
    isAstro,
    problems,
    astroVersion,
    astroMajor,
    packageManager: detectPackageManager(cwd, pkg),
    clientDeclared: deps[CLIENT_PACKAGE] ?? null,
    clientVersion: deps[CLIENT_PACKAGE] ? installedVersion(cwd, CLIENT_PACKAGE, pkg) : null,
    cloudflare: typeof deps['@astrojs/cloudflare'] === 'string',
    configName,
    configText,
    hasAdapter: configText ? /adapter\s*:/.test(configText) : false,
    wranglerName,
    wranglerText,
  };
}
