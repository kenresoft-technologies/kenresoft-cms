import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'astro-integration');

export const MANIFEST_PATH = '.kenresoft/integration.json';
export const PROXY_PATH = 'src/pages/cms/[...path].ts';
export const CLIENT_LIB_PATH = 'src/lib/kenresoft.ts';

const HEADER = [
  '// @kenresoft-managed: this file is owned by `npx @kenresoft-cms/create astro`.',
  '// `--update` refreshes it while it is unmodified; if you edit it, updates report a conflict',
  '// instead of overwriting. Put your own code in your own files.',
  '',
  '',
].join('\n');

const normalize = (text) => text.replace(/\r\n/g, '\n');
export const hashContent = (text) => createHash('sha256').update(normalize(text)).digest('hex');

/** The full set of files this integration owns, rendered for a given project. */
export function renderManagedFiles({ cloudflare }) {
  const read = (name) => normalize(readFileSync(join(TEMPLATES, name), 'utf8'));
  return {
    [PROXY_PATH]: HEADER + read(cloudflare ? 'proxy.cloudflare.ts' : 'proxy.node.ts'),
    [CLIENT_LIB_PATH]: HEADER + read('kenresoft.ts'),
  };
}

export function readManifest(cwd) {
  try {
    const m = JSON.parse(readFileSync(join(cwd, MANIFEST_PATH), 'utf8'));
    return m && typeof m === 'object' && m.files ? m : null;
  } catch {
    return null;
  }
}

export function writeManifest(cwd, manifest) {
  const full = join(cwd, MANIFEST_PATH);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Reconcile one managed file. Never overwrites content we did not write and that the user has
 * since changed (unless `force`). Returns { status, hash } where status is one of:
 * created | updated | unchanged | adopted | conflict | forced.
 * `recorded` is the hash we wrote last time (undefined if this file was never ours).
 */
export function syncManagedFile(cwd, rel, content, recorded, { force = false } = {}) {
  const full = join(cwd, rel);
  const next = hashContent(content);
  const write = () => {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  if (!existsSync(full)) {
    write();
    return { status: 'created', hash: next };
  }
  const current = hashContent(readFileSync(full, 'utf8'));
  if (current === next) return { status: recorded === next ? 'unchanged' : 'adopted', hash: next };
  if (recorded !== undefined && current === recorded) {
    write();
    return { status: 'updated', hash: next };
  }
  if (force) {
    write();
    return { status: 'forced', hash: next };
  }
  // Locally modified (or someone else's file at our path): leave it, keep the old record.
  return { status: 'conflict', hash: recorded };
}

/** Append KEY=value to an env file only if KEY is not already defined. */
export function ensureEnvVar(cwd, file, key, value) {
  const full = join(cwd, file);
  const existing = existsSync(full) ? readFileSync(full, 'utf8') : null;
  const line = new RegExp(`^\\s*${key}\\s*=(.*)$`, 'm').exec(existing ?? '');
  if (line) return { status: 'exists', value: line[1].trim() };
  const prefix = existing === null || existing === '' || existing.endsWith('\n') ? (existing ?? '') : `${existing}\n`;
  writeFileSync(full, `${prefix}${key}=${value}\n`);
  return { status: existing === null ? 'created' : 'added' };
}
