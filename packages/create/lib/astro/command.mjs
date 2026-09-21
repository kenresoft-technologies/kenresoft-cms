import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrateAstro } from './integrate.mjs';
import { fetchClientMetadata } from './versions.mjs';

const USAGE = `Usage:
  npx @kenresoft-cms/create astro [--cms-url <url>] [--no-install]   connect this Astro project to a CMS
  npx @kenresoft-cms/create astro --update [--force] [--no-install]   refresh the managed integration files

Run from the root of an existing Astro project. Never touches your CMS deployment.`;

export function parseAstroArgs(argv) {
  const opts = { update: false, force: false, noInstall: false, cmsUrl: undefined, help: false, dir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') opts.update = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--no-install') opts.noInstall = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--cms-url') opts.cmsUrl = argv[++i];
    else if (a.startsWith('--cms-url=')) opts.cmsUrl = a.slice('--cms-url='.length);
    else if (a === '--dir') opts.dir = argv[++i];
    else throw new Error(`Unknown argument: ${a}\n\n${USAGE}`);
  }
  if (opts.cmsUrl !== undefined) {
    try {
      const u = new URL(opts.cmsUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
      opts.cmsUrl = opts.cmsUrl.replace(/\/+$/, '');
    } catch {
      throw new Error(`--cms-url must be an http(s) URL, got "${opts.cmsUrl}"`);
    }
  }
  return opts;
}

const ADD_COMMANDS = {
  npm: (spec) => ['install', spec],
  pnpm: (spec) => ['add', spec],
  yarn: (spec) => ['add', spec],
  bun: (spec) => ['add', spec],
};

function realInstall(cwd, packageManager, spec) {
  const result = spawnSync(packageManager, ADD_COMMANDS[packageManager](spec), {
    cwd,
    stdio: 'inherit',
    // Windows resolves pnpm/npm/yarn via .cmd shims, which need a shell.
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`${packageManager} failed to install ${spec}.`);
}

function printReport(report, log) {
  const sections = [
    ['Created', report.created],
    ['Updated', report.updated],
    ['Unchanged', report.unchanged],
    ['Skipped', report.skipped],
    ['Conflicts (not modified)', report.conflicts],
    ['Needs manual action', report.manual],
    ['Notes', report.notes],
  ];
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    log(`\n${title}:`);
    for (const item of items) log(`  - ${item}`);
  }
}

export async function runAstroCommand(argv, { log = console.log, deps } = {}) {
  const opts = parseAstroArgs(argv);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const cwd = resolve(process.cwd(), opts.dir ?? '.');
  const here = dirname(fileURLToPath(import.meta.url));
  const cliVersion = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')).version;

  const result = await integrateAstro({
    cwd,
    mode: opts.update ? 'update' : 'init',
    options: opts,
    cliVersion,
    deps: deps ?? { fetchMeta: fetchClientMetadata, install: realInstall },
  });
  if (result.error) {
    log(result.error);
    return 1;
  }
  log(opts.update ? 'Kenresoft Astro integration update' : 'Kenresoft Astro integration');
  printReport(result.report, log);
  log(
    result.conflicted
      ? '\nFinished with conflicts — nothing you own was overwritten.'
      : '\nDone. Only files listed above were touched; your routes, layouts, components and styles are untouched.',
  );
  return result.conflicted ? 2 : 0;
}
