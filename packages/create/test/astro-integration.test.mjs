import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { parseAstroArgs, runAstroCommand } from '../lib/astro/command.mjs';
import { integrateAstro } from '../lib/astro/integrate.mjs';
import {
  CLIENT_LIB_PATH,
  MANIFEST_PATH,
  PROXY_PATH,
  hashContent,
  readManifest,
  renderManagedFiles,
} from '../lib/astro/managed.mjs';
import { detectProject } from '../lib/astro/project.mjs';
import { compareVersions, pickCompatibleVersion } from '../lib/astro/versions.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const META = {
  versions: {
    '0.4.0': {},
    '0.5.1': {},
    '0.6.0': { peerDependencies: { astro: '^5 || ^6 || ^7' } },
    '0.7.0': { peerDependencies: { astro: '^7' } },
    '0.8.0-beta.1': {},
  },
};

function project(pkg, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kr-astro-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'site', ...pkg }, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

function setInstalled(dir, name, version) {
  const p = join(dir, 'node_modules', ...name.split('/'));
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'package.json'), JSON.stringify({ name, version }));
}

function makeDeps(meta = META) {
  const installs = [];
  return {
    installs,
    fetchMeta: async () => meta,
    install(cwd, pm, spec) {
      installs.push({ pm, spec });
      const at = spec.lastIndexOf('@');
      const name = spec.slice(0, at);
      const range = spec.slice(at + 1);
      const pkgPath = join(cwd, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.dependencies = { ...pkg.dependencies, [name]: range };
      writeFileSync(pkgPath, JSON.stringify(pkg));
      setInstalled(cwd, name, range.replace(/^\^/, ''));
    },
  };
}

const astro7 = { dependencies: { astro: '^7.3.1' } };
const run = (dir, mode, deps, options = {}) => integrateAstro({ cwd: dir, mode, options, deps });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

describe('detection', () => {
  it('detects an Astro project, its version, package manager and adapter', () => {
    const dir = project(
      { dependencies: { astro: '^7.3.1', '@astrojs/cloudflare': '^14.3.0', '@kenresoft-cms/astro': '^0.3.0' } },
      { 'pnpm-lock.yaml': '', 'astro.config.mjs': 'export default { adapter: cloudflare() }' },
    );
    setInstalled(dir, 'astro', '7.3.2');
    const p = detectProject(dir);
    assert.equal(p.isAstro, true);
    assert.equal(p.astroVersion, '7.3.2');
    assert.equal(p.astroMajor, 7);
    assert.equal(p.packageManager, 'pnpm');
    assert.equal(p.cloudflare, true);
    assert.equal(p.hasAdapter, true);
    assert.equal(p.clientVersion, '0.3.0');
    assert.deepEqual(p.problems, []);
  });

  it('rejects a directory with no package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kr-empty-'));
    dirs.push(dir);
    assert.match(detectProject(dir).problems[0], /package\.json/);
  });

  it('rejects a non-Astro project and an unsupported Astro major', () => {
    assert.match(detectProject(project({ dependencies: { react: '^19' } })).problems[0], /Astro project/);
    assert.match(detectProject(project({ dependencies: { astro: '^4.16.0' } })).problems[0], /not supported/);
  });

  it('reports package.json-less and unsupported projects as failures from integrateAstro', async () => {
    const r = await run(project({ dependencies: { astro: '^4.0.0' } }), 'init', makeDeps());
    assert.equal(r.ok, false);
    assert.match(r.error, /not supported/);
  });
});

describe('version selection', () => {
  it('compares versions and picks the newest compatible stable one', () => {
    assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
    assert.equal(pickCompatibleVersion(META, 5), '0.6.0'); // 0.7.0 needs Astro 7; prerelease skipped
    assert.equal(pickCompatibleVersion(META, 7), '0.7.0');
    assert.equal(pickCompatibleVersion({ versions: { '0.4.0': {} } }, 7), null); // below the minimum
  });

  it('crosses 0.x minors explicitly (^0.3.0 would never reach 0.6.0 by itself)', async () => {
    const dir = project({ dependencies: { astro: '^7.3.1', '@kenresoft-cms/astro': '^0.5.1' } });
    setInstalled(dir, '@kenresoft-cms/astro', '0.5.1');
    const deps = makeDeps();
    await run(dir, 'init', deps, { cmsUrl: 'https://cms.example.com' });
    // 0.5.1 is >= the minimum, so init leaves it; --update moves it.
    assert.equal(deps.installs.length, 0);
    await run(dir, 'update', deps);
    assert.deepEqual(deps.installs, [{ pm: 'npm', spec: '@kenresoft-cms/astro@^0.7.0' }]);
  });
});

describe('init', () => {
  it('sets up a fresh Astro project (no Kenresoft package) and reports everything', async () => {
    const dir = project(astro7, { 'src/pages/index.astro': '<h1>mine</h1>', '.env': 'FOO=1\n' });
    const deps = makeDeps();
    const r = await run(dir, 'init', deps, { cmsUrl: 'https://cms.example.com' });
    assert.equal(r.ok, true);
    assert.equal(deps.installs[0].spec, '@kenresoft-cms/astro@^0.7.0');
    assert.ok(existsSync(join(dir, PROXY_PATH)));
    assert.ok(existsSync(join(dir, CLIENT_LIB_PATH)));
    assert.match(read(dir, '.env'), /FOO=1\nPUBLIC_KENRESOFT_CMS_URL=https:\/\/cms\.example\.com\n/);
    assert.match(read(dir, '.env.example'), /PUBLIC_KENRESOFT_CMS_URL=/);
    assert.equal(read(dir, 'src/pages/index.astro'), '<h1>mine</h1>');
    assert.ok(readManifest(dir).files[PROXY_PATH].sha256);
    assert.ok(r.report.created.length >= 4);
  });

  it('uses the Cloudflare proxy variant only when the Cloudflare adapter is present', async () => {
    const cf = project({ dependencies: { ...astro7.dependencies, '@astrojs/cloudflare': '^14.3.0' } });
    await run(cf, 'init', makeDeps());
    assert.match(read(cf, PROXY_PATH), /cloudflare:workers/);
    const node = project(astro7);
    await run(node, 'init', makeDeps());
    assert.doesNotMatch(read(node, PROXY_PATH), /cloudflare:workers/);
  });

  it('upgrades an installed version older than the managed files need', async () => {
    const dir = project({ dependencies: { astro: '^7.3.1', '@kenresoft-cms/astro': '^0.3.0' } });
    setInstalled(dir, '@kenresoft-cms/astro', '0.3.0');
    const deps = makeDeps();
    await run(dir, 'init', deps);
    assert.equal(deps.installs.length, 1);
    assert.equal(JSON.parse(read(dir, 'package.json')).dependencies['@kenresoft-cms/astro'], '^0.7.0');
  });

  it('--no-install edits package.json only and says to install', async () => {
    const dir = project(astro7);
    const deps = makeDeps();
    const r = await run(dir, 'init', deps, { noInstall: true });
    assert.equal(deps.installs.length, 0);
    assert.equal(JSON.parse(read(dir, 'package.json')).dependencies['@kenresoft-cms/astro'], '^0.7.0');
    assert.ok(r.report.manual.some((m) => /install/.test(m)));
  });

  it('is idempotent: a second run changes nothing and duplicates nothing', async () => {
    const dir = project(astro7);
    const deps = makeDeps();
    await run(dir, 'init', deps, { cmsUrl: 'https://cms.example.com' });
    const snapshot = [PROXY_PATH, CLIENT_LIB_PATH, MANIFEST_PATH, '.env', '.env.example'].map((f) => read(dir, f));
    const again = await run(dir, 'init', deps, { cmsUrl: 'https://cms.example.com' });
    assert.equal(again.ok, true);
    assert.deepEqual(
      [PROXY_PATH, CLIENT_LIB_PATH, MANIFEST_PATH, '.env', '.env.example'].map((f) => read(dir, f)),
      snapshot,
    );
    assert.equal(deps.installs.length, 1);
    assert.equal(again.report.created.length, 0);
    assert.equal((read(dir, '.env').match(/PUBLIC_KENRESOFT_CMS_URL/g) ?? []).length, 1);
  });

  it('preserves custom routes/layouts/components and an existing CMS URL', async () => {
    const files = {
      'src/pages/index.astro': 'home',
      'src/pages/blog/[slug].astro': 'post',
      'src/layouts/Base.astro': 'layout',
      'src/components/Card.astro': 'card',
      'src/styles/global.css': 'body{}',
      'src/lib/cms.ts': 'export const mine = 1;',
      '.env': 'PUBLIC_KENRESOFT_CMS_URL=https://existing.example.com\n',
    };
    const dir = project(astro7, files);
    const r = await run(dir, 'init', makeDeps(), { cmsUrl: 'https://other.example.com' });
    for (const [rel, content] of Object.entries(files)) assert.equal(read(dir, rel), content, rel);
    assert.ok(r.report.manual.some((m) => /existing\.example\.com/.test(m)));
  });

  it('reports a conflict, without overwriting, when a different file already sits at the proxy path', async () => {
    const mine = 'export const ALL = () => new Response("my own proxy");\n';
    const dir = project(astro7, { [PROXY_PATH]: mine });
    const r = await run(dir, 'init', makeDeps());
    assert.equal(r.ok, false);
    assert.equal(r.conflicted, true);
    assert.deepEqual(r.report.conflicts, [PROXY_PATH]);
    assert.equal(read(dir, PROXY_PATH), mine);
    assert.equal(readManifest(dir).files[PROXY_PATH], undefined);
  });

  it('warns about other /cms routes and a /cms reference in astro.config', async () => {
    const dir = project(astro7, {
      'src/pages/cms/index.astro': 'x',
      'astro.config.mjs': "export default { vite: { server: { proxy: { '/cms': 'http://x' } } } }",
    });
    const r = await run(dir, 'init', makeDeps());
    assert.ok(r.report.manual.some((m) => m.includes('src/pages/cms/index.astro') && /astro config/i.test(m)));
  });

  it('flags a missing adapter and a missing Cloudflare compatibility flag as manual work', async () => {
    const noAdapter = await run(project(astro7), 'init', makeDeps());
    assert.ok(noAdapter.report.manual.some((m) => /adapter/i.test(m)));
    const cf = project(
      { dependencies: { ...astro7.dependencies, '@astrojs/cloudflare': '^14.3.0' } },
      { 'wrangler.jsonc': '{ "name": "site" }', 'astro.config.mjs': 'export default { adapter: cloudflare() }' },
    );
    const withFlag = await run(cf, 'init', makeDeps());
    assert.ok(withFlag.report.manual.some((m) => m.includes('global_fetch_strictly_public')));
    assert.equal(read(cf, 'wrangler.jsonc'), '{ "name": "site" }'); // reported, never edited
  });

  it('works for a CMS hosted elsewhere (separate deployment/repo): only a URL is needed', async () => {
    const dir = project(astro7);
    const r = await run(dir, 'init', makeDeps(), { cmsUrl: 'https://api.other-company.com' });
    assert.equal(r.ok, true);
    assert.match(read(dir, '.env'), /https:\/\/api\.other-company\.com/);
    assert.ok(!existsSync(join(dir, 'wrangler.toml'))); // nothing CMS-side is created
  });

  it('adopts a byte-identical pre-existing managed file without reporting a conflict', async () => {
    const dir = project(astro7);
    const content = renderManagedFiles({ cloudflare: false })[PROXY_PATH];
    mkdirSync(join(dir, 'src/pages/cms'), { recursive: true });
    writeFileSync(join(dir, PROXY_PATH), content.replace(/\n/g, '\r\n')); // CRLF checkout
    const r = await run(dir, 'init', makeDeps());
    assert.equal(r.report.conflicts.length, 0);
    assert.equal(readManifest(dir).files[PROXY_PATH].sha256, hashContent(content));
  });
});

describe('update', () => {
  async function installed() {
    const dir = project(astro7);
    const deps = makeDeps({ versions: { '0.6.0': {} } });
    await integrateAstro({ cwd: dir, mode: 'init', options: {}, deps });
    return dir;
  }

  it('refuses when there is no integration to update', async () => {
    const r = await run(project(astro7), 'update', makeDeps());
    assert.equal(r.ok, false);
    assert.match(r.error, /No Kenresoft Astro integration/);
  });

  it('refuses when the package is installed but was not set up by this tool', async () => {
    const dir = project({ dependencies: { ...astro7.dependencies, '@kenresoft-cms/astro': '^0.6.0' } });
    const r = await run(dir, 'update', makeDeps());
    assert.match(r.error, /adopts existing files/);
  });

  it('upgrades the package to the latest compatible version', async () => {
    const dir = await installed();
    const deps = makeDeps();
    const r = await run(dir, 'update', deps);
    assert.equal(r.ok, true);
    assert.equal(deps.installs[0].spec, '@kenresoft-cms/astro@^0.7.0');
    assert.ok(r.report.updated.some((u) => u.includes('0.6.0 → 0.7.0')));
  });

  it('is a no-op when already current, and never touches env files', async () => {
    const dir = await installed();
    const env = read(dir, '.env');
    const deps = makeDeps({ versions: { '0.6.0': {} } });
    const r = await run(dir, 'update', deps);
    assert.equal(deps.installs.length, 0);
    assert.equal(r.report.updated.length, 0);
    assert.equal(read(dir, '.env'), env);
  });

  it('refreshes an unmodified managed file whose template changed (stale recorded hash)', async () => {
    const dir = await installed();
    const stale = '// old generated content\n';
    writeFileSync(join(dir, PROXY_PATH), stale);
    const manifest = readManifest(dir);
    manifest.files[PROXY_PATH].sha256 = hashContent(stale);
    writeFileSync(join(dir, MANIFEST_PATH), JSON.stringify(manifest));
    const r = await run(dir, 'update', makeDeps({ versions: { '0.6.0': {} } }));
    assert.ok(r.report.updated.includes(PROXY_PATH));
    assert.equal(hashContent(read(dir, PROXY_PATH)), hashContent(renderManagedFiles({ cloudflare: false })[PROXY_PATH]));
  });

  it('reports a conflict instead of overwriting a managed file the developer edited; --force replaces it', async () => {
    const dir = await installed();
    const edited = `${read(dir, CLIENT_LIB_PATH)}\nexport const custom = 1;\n`;
    writeFileSync(join(dir, CLIENT_LIB_PATH), edited);
    const r = await run(dir, 'update', makeDeps({ versions: { '0.6.0': {} } }));
    assert.equal(r.conflicted, true);
    assert.deepEqual(r.report.conflicts, [CLIENT_LIB_PATH]);
    assert.equal(read(dir, CLIENT_LIB_PATH), edited);
    const forced = await run(dir, 'update', makeDeps({ versions: { '0.6.0': {} } }), { force: true });
    assert.equal(forced.ok, true);
    assert.doesNotMatch(read(dir, CLIENT_LIB_PATH), /custom/);
  });

  it('recreates a deleted managed file and never touches developer-owned files', async () => {
    const dir = await installed();
    writeFileSync(join(dir, 'src/pages/index.astro'), 'mine');
    rmSync(join(dir, PROXY_PATH));
    const r = await run(dir, 'update', makeDeps({ versions: { '0.6.0': {} } }));
    assert.ok(r.report.created.includes(PROXY_PATH));
    assert.equal(read(dir, 'src/pages/index.astro'), 'mine');
  });
});

describe('command', () => {
  it('parses flags and validates --cms-url', () => {
    assert.deepEqual(
      { u: parseAstroArgs(['--update', '--force']).update, f: parseAstroArgs(['--force']).force },
      { u: true, f: true },
    );
    assert.equal(parseAstroArgs(['--cms-url', 'https://a.com/']).cmsUrl, 'https://a.com');
    assert.throws(() => parseAstroArgs(['--cms-url', 'nope']), /http\(s\) URL/);
    assert.throws(() => parseAstroArgs(['--wat']), /Unknown argument/);
  });

  it('returns exit codes: 1 for errors, 2 for conflicts, 0 for success', async () => {
    const logs = [];
    const log = (m) => logs.push(m);
    const empty = mkdtempSync(join(tmpdir(), 'kr-cmd-'));
    dirs.push(empty);
    assert.equal(await runAstroCommand(['--dir', empty], { log, deps: makeDeps() }), 1);
    const ok = project(astro7);
    assert.equal(await runAstroCommand(['--dir', ok], { log, deps: makeDeps() }), 0);
    writeFileSync(join(ok, PROXY_PATH), 'mine');
    rmSync(join(ok, MANIFEST_PATH));
    assert.equal(await runAstroCommand(['--dir', ok], { log, deps: makeDeps() }), 2);
    assert.ok(logs.some((l) => /Conflicts/.test(l)));
  });
});

describe('shared architecture with the starter', () => {
  it('the Cloudflare proxy template is byte-identical to the starter\'s proxy route', () => {
    const starter = readFileSync(
      new URL('../templates/astro-starter/src/pages/cms/[...path].ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const managed = renderManagedFiles({ cloudflare: true })[PROXY_PATH];
    const body = (t) =>
      t
        .split('\n')
        .filter((l) => !/^\/\/ (@kenresoft-managed|`--update`|instead of overwriting|@ts-ignore)/.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    assert.equal(body(managed), body(starter));
  });

  it('both use the same runtime API from @kenresoft-cms/astro', () => {
    const starterLib = readFileSync(new URL('../templates/astro-starter/src/lib/cms.ts', import.meta.url), 'utf8');
    const managedLib = renderManagedFiles({ cloudflare: false })[CLIENT_LIB_PATH];
    for (const api of ['createKenresoftClient', 'cookies:', "url: '/cms'"]) {
      assert.ok(starterLib.includes(api) || readFileSync(new URL('../templates/astro-starter/src/lib/browser-cms.ts', import.meta.url), 'utf8').includes(api), api);
      assert.ok(managedLib.includes(api), api);
    }
  });
});
