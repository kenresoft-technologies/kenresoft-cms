import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_LIB_PATH,
  MANIFEST_PATH,
  PROXY_PATH,
  ensureEnvVar,
  readManifest,
  renderManagedFiles,
  syncManagedFile,
  writeManifest,
} from './managed.mjs';
import { detectProject } from './project.mjs';
import { CLIENT_PACKAGE, MIN_CLIENT_VERSION, compareVersions, pickCompatibleVersion } from './versions.mjs';

const ENV_KEY = 'PUBLIC_KENRESOFT_CMS_URL';
const DEFAULT_CMS_URL = 'http://localhost:8787';

function emptyReport() {
  return { created: [], updated: [], unchanged: [], skipped: [], conflicts: [], manual: [], notes: [] };
}

function fail(report, message) {
  return { ok: false, error: message, report };
}

// Everything that could make /cms/* collide with something the developer already has.
function findProxyCollisions(cwd, config) {
  const found = [];
  const dir = join(cwd, 'src', 'pages', 'cms');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (`src/pages/cms/${name}` !== PROXY_PATH) found.push(`src/pages/cms/${name}`);
    }
  }
  if (config && /['"`]\/cms(\/|['"`])/.test(config)) found.push('a "/cms" reference in your Astro config');
  return found;
}

/**
 * Connect an existing Astro project to a Kenresoft CMS (`mode: 'init'`) or refresh what this
 * tool owns (`mode: 'update'`). Touches only: the @kenresoft-cms/astro dependency, the managed
 * files listed in managed.mjs, .kenresoft/integration.json, and (init only) two env files.
 * Never touches the CMS deployment — it has no knowledge of one beyond its public URL.
 *
 * deps: { fetchMeta(): registry doc | null, install(cwd, packageManager, spec): void }
 */
export async function integrateAstro({ cwd, mode, options = {}, deps, cliVersion = '0.0.0' }) {
  const report = emptyReport();
  const project = detectProject(cwd);
  if (project.problems.length > 0) return fail(report, project.problems.join('\n'));

  const previous = readManifest(cwd);
  if (mode === 'update' && !previous) {
    return fail(
      report,
      project.clientDeclared
        ? `${CLIENT_PACKAGE} is installed but this project has no ${MANIFEST_PATH}. Run \`npx @kenresoft-cms/create astro\` first — it adopts existing files safely and never overwrites your own.`
        : 'No Kenresoft Astro integration found here. Run `npx @kenresoft-cms/create astro` to set one up.',
    );
  }

  // 1. Which @kenresoft-cms/astro version? Explicit lookup, never a caret assumption (0.x).
  const meta = await deps.fetchMeta();
  const target = meta ? pickCompatibleVersion(meta, project.astroMajor) : null;
  const installed = project.clientVersion;
  const tooOld = installed !== null && compareVersions(installed, MIN_CLIENT_VERSION) < 0;

  let wantInstall = false;
  if (installed === null) wantInstall = true;
  else if (mode === 'update' || tooOld) wantInstall = target !== null && compareVersions(installed, target) < 0;

  if (installed === null && !target) {
    return fail(
      report,
      meta
        ? `No published ${CLIENT_PACKAGE} version is compatible with Astro ${project.astroVersion}.`
        : `Could not reach the npm registry to look up ${CLIENT_PACKAGE}. Check your connection and retry.`,
    );
  }
  if (!meta) report.notes.push('npm registry unreachable — kept the currently installed package version.');
  if (tooOld && !wantInstall) {
    report.manual.push(
      `${CLIENT_PACKAGE} ${installed} is older than ${MIN_CLIENT_VERSION}, which the managed files need. Upgrade it manually.`,
    );
  }

  if (wantInstall) {
    const spec = `^${target}`;
    if (options.noInstall) {
      const section = project.pkg.devDependencies?.[CLIENT_PACKAGE] ? 'devDependencies' : 'dependencies';
      project.pkg[section] = { ...project.pkg[section], [CLIENT_PACKAGE]: spec };
      const sorted = Object.fromEntries(Object.entries(project.pkg[section]).sort(([a], [b]) => a.localeCompare(b)));
      project.pkg[section] = sorted;
      writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, 2)}\n`);
      report.manual.push(`Run \`${project.packageManager} install\` to fetch ${CLIENT_PACKAGE}@${target}.`);
    } else {
      deps.install(cwd, project.packageManager, `${CLIENT_PACKAGE}@${spec}`);
    }
    report[installed === null ? 'created' : 'updated'].push(
      `${CLIENT_PACKAGE}: ${installed === null ? `installed ${target}` : `${installed} → ${target}`}`,
    );
  } else {
    report.unchanged.push(`${CLIENT_PACKAGE} ${installed ?? ''}`.trim());
  }

  // 2. Managed files.
  const files = renderManagedFiles({ cloudflare: project.cloudflare });
  const recorded = { ...(previous?.files ?? {}) };
  const nextFiles = { ...recorded };
  for (const [rel, content] of Object.entries(files)) {
    const result = syncManagedFile(cwd, rel, content, recorded[rel]?.sha256, { force: options.force });
    if (result.hash) nextFiles[rel] = { sha256: result.hash };
    if (result.status === 'conflict') {
      report.conflicts.push(rel);
      report.manual.push(
        `${rel} differs from what Kenresoft would generate and was NOT changed. Compare it with the template, ` +
          'then either merge the differences yourself or re-run with --force to replace it.',
      );
    } else if (result.status === 'created') report.created.push(rel);
    else if (result.status === 'updated' || result.status === 'forced') report.updated.push(rel);
    else if (result.status === 'adopted') report.unchanged.push(`${rel} (already matched — now tracked)`);
    else report.unchanged.push(rel);
  }

  // 3. Environment (init only — update never rewrites the developer's configuration).
  if (mode === 'init') {
    const url = options.cmsUrl ?? DEFAULT_CMS_URL;
    let urlAlreadySet = false;
    for (const file of ['.env', '.env.example']) {
      const r = ensureEnvVar(cwd, file, ENV_KEY, file === '.env' ? url : DEFAULT_CMS_URL);
      if (r.status === 'exists') {
        if (file === '.env') urlAlreadySet = true;
        report.skipped.push(`${file}: ${ENV_KEY} already set`);
        if (file === '.env' && options.cmsUrl && r.value !== options.cmsUrl) {
          report.manual.push(`.env already sets ${ENV_KEY}=${r.value}; left as is (you passed ${options.cmsUrl}).`);
        }
      } else report[r.status === 'created' ? 'created' : 'updated'].push(`${file}: ${ENV_KEY}`);
    }
    if (!options.cmsUrl && !urlAlreadySet) {
      report.manual.push(`Set ${ENV_KEY} in .env to your CMS API URL (defaulted to ${DEFAULT_CMS_URL}).`);
    }
  }

  // 4. Things we detect but deliberately never edit for the developer.
  const collisions = findProxyCollisions(cwd, project.configText);
  if (collisions.length > 0) {
    report.manual.push(`Possible existing /cms handling: ${collisions.join(', ')}. Make sure only one thing serves /cms/*.`);
  }
  if (!project.hasAdapter) {
    report.manual.push(
      'No server adapter found in your Astro config. The /cms proxy needs on-demand rendering: add an adapter (e.g. `astro add cloudflare`) and make sure server routes are enabled.',
    );
  }
  if (project.cloudflare) {
    if (project.wranglerText && !project.wranglerText.includes('global_fetch_strictly_public')) {
      report.manual.push(
        `Add "global_fetch_strictly_public" to compatibility_flags in ${project.wranglerName} (needed when your CMS API is on the same Cloudflare account).`,
      );
    } else if (!project.wranglerText) {
      report.manual.push(
        'When deploying to Cloudflare, add the "global_fetch_strictly_public" compatibility flag in your wrangler config if your CMS API is on the same account.',
      );
    }
  }
  if (mode === 'init') {
    report.manual.push(
      'Optional: set the same TRUSTED_PROXY_SECRET on this site and on your CMS API so per-IP rate limits see real visitors.',
      'Your CMS must list this site\'s origin in CORS_ORIGINS (and BETTER_AUTH_URL must stay the API\'s own URL).',
    );
  }

  writeManifest(cwd, {
    schema: 1,
    package: CLIENT_PACKAGE,
    cliVersion,
    cloudflare: project.cloudflare,
    files: nextFiles,
  });

  return { ok: report.conflicts.length === 0, conflicted: report.conflicts.length > 0, report };
}

export { CLIENT_LIB_PATH, PROXY_PATH, MANIFEST_PATH };

// Exposed for tests/inspection.
export function readPackageJson(cwd) {
  return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
}
