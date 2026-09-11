// Shared wrangler.toml text-manipulation helpers — originally lived only in scripts/setup.mjs,
// pulled out here once scripts/update.mjs also needed to read (never write, for update.mjs) the
// same structures: the D1 database_id and each Worker's top-level `name` field, to guard against
// silently overwriting an unrelated deployment (see checkWorkerOwnership in deploy-helpers.mjs).
import { readFileSync, writeFileSync } from 'node:fs';

// Every helper below matches against a bare "\n" — correct for this repo's own committed LF line
// endings, but a real install's wrangler.toml doesn't necessarily stay that way: a fresh
// `git clone` (packages/create's own scaffolding mechanism) checks files out through git's
// line-ending filters, and Windows Git commonly defaults to `core.autocrlf=true`, converting
// every line to CRLF on checkout. Confirmed live: a real install's wrangler.toml had CRLF
// endings, and a plain toml.indexOf('[[d1_databases]]\n') never matched
// `[[d1_databases]]\r\n`, failing `pnpm run setup` outright on a re-run. Normalizing to bare LF
// on read and restoring each file's own original line-ending style on write means every helper
// below can keep assuming plain "\n" without needing its own CRLF-handling. Tracked per path
// (not a single module-level flag) since setup.mjs reads/writes two different wrangler.toml
// files (the API's and the admin's) which don't have to share a line-ending style.
const lineEndings = new Map();

export function readTomlFile(path) {
  const raw = readFileSync(path, 'utf8');
  lineEndings.set(path, raw.includes('\r\n') ? '\r\n' : '\n');
  return raw.replace(/\r\n/g, '\n');
}

export function writeTomlFile(path, content) {
  const ending = lineEndings.get(path) ?? '\n';
  writeFileSync(path, ending === '\r\n' ? content.replace(/\n/g, '\r\n') : content);
}

// Isolates the top-level (not [env.production.*]) array-table block for `header` — e.g.
// "[[d1_databases]]" — so edits never touch Kenresoft's own pinned production section, which
// uses the distinctly-named "[[env.production.d1_databases]]" header instead.
export function findTopLevelBlock(toml, header) {
  const start = toml.indexOf(`${header}\n`);
  if (start === -1) return null;
  const bodyStart = start + header.length + 1;
  const nextHeader = toml.slice(bodyStart).search(/\n\[/);
  const end = nextHeader === -1 ? toml.length : bodyStart + nextHeader + 1;
  return { start, end, text: toml.slice(start, end) };
}

export function insertAfterLine(blockText, anchorLine, newLine) {
  const idx = blockText.indexOf(anchorLine);
  if (idx === -1) {
    throw new Error(`Expected to find the line "${anchorLine.trim()}" in wrangler.toml — has the file's shape changed?`);
  }
  const insertAt = idx + anchorLine.length;
  return blockText.slice(0, insertAt) + newLine + blockText.slice(insertAt);
}

export function replaceLine(toml, linePrefix, newLine) {
  const lines = toml.split('\n');
  const idx = lines.findIndex((line) => line.startsWith(linePrefix));
  if (idx === -1) throw new Error(`Expected to find a line starting with "${linePrefix}" in wrangler.toml.`);
  lines[idx] = newLine;
  return lines.join('\n');
}

// Reads a `key = "value"` line's value out of one wrangler.toml block — e.g. recovering the
// *actual* database_name/bucket_name a previous setup run settled on, rather than assuming it's
// still the hardcoded default (see scripts/setup.mjs's createUniqueResource).
export function extractTomlValue(blockText, key) {
  const match = blockText.match(new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`));
  return match?.[1] ?? null;
}

// The top-level Worker `name` field sits in each wrangler.toml's preamble, before any
// `[section]`/`[[array-table]]` header — restricting the search to that preamble specifically
// (rather than matching the first line anywhere in the file starting with `name = "`) avoids any
// ambiguity with the *different* `name = "..."` fields inside `[[ratelimits]]` blocks further
// down the same file.
function preambleEnd(toml) {
  const idx = toml.search(/^\[/m);
  return idx === -1 ? toml.length : idx;
}

export function readWorkerName(path) {
  const toml = readTomlFile(path);
  const match = toml.slice(0, preambleEnd(toml)).match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`Could not find a top-level "name" field before the first [section] in ${path}.`);
  return match[1];
}

export function writeWorkerName(path, name) {
  const toml = readTomlFile(path);
  const cut = preambleEnd(toml);
  const preamble = toml.slice(0, cut).replace(/^name\s*=\s*"[^"]*"/m, `name = "${name}"`);
  writeTomlFile(path, preamble + toml.slice(cut));
}

// The D1 database_id this install's own wrangler.toml records, if setup.mjs's ensureD1() has
// ever run successfully — the cheapest, purely-local signal for "has this install actually been
// set up," and the per-clone fingerprint checkWorkerOwnership() compares a live Worker's D1
// binding against.
export function readDatabaseId(path) {
  const block = findTopLevelBlock(readTomlFile(path), '[[d1_databases]]');
  return block ? extractTomlValue(block.text, 'database_id') : null;
}

// Generic [vars] editing, replacing the old pattern of anchoring one field's insertion to another
// field's own line (e.g. inserting EMAIL_PROVIDER/EMAIL_FROM by replacing the whole
// "BETTER_AUTH_URL =" line) — that pattern is exactly how setting up email used to also silently
// reset BETTER_AUTH_URL back to the pre-deploy placeholder. Each of these touches exactly the one
// key it's given and nothing else. Safe against this file's shape specifically because there is
// exactly one `[vars]` block and no `[env.*.vars]` variants (the project's own history: a stale
// `[env.production]` block was deliberately removed) — a key is matched anywhere before the next
// `[section]`, same assumption every other var-editing helper in this file already makes.
export function hasVarLine(toml, key) {
  return new RegExp(`^${key}\\s*=`, 'm').test(toml);
}

export function readVarLine(toml, key) {
  return toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? null;
}

export function setVarLine(toml, key, value) {
  const line = `${key} = "${value}"`;
  if (hasVarLine(toml, key)) {
    return toml.replace(new RegExp(`^${key}\\s*=.*$`, 'm'), line);
  }
  const varsHeaderIdx = toml.indexOf('[vars]\n');
  if (varsHeaderIdx === -1) throw new Error('Could not find [vars] in wrangler.toml.');
  const insertAt = varsHeaderIdx + '[vars]\n'.length;
  return toml.slice(0, insertAt) + line + '\n' + toml.slice(insertAt);
}

export function removeVarLine(toml, key) {
  return toml.replace(new RegExp(`^${key}\\s*=.*\\n?`, 'm'), '');
}

// `workers_dev` (wrangler's own field controlling the Worker's *.workers.dev subdomain) sits in
// the preamble, same as `name` above — wrangler treats it as `true` when absent, so "absent" and
// "true" read the same here.
export function readWorkersDevEnabled(toml) {
  const match = toml.slice(0, preambleEnd(toml)).match(/^workers_dev\s*=\s*(true|false)/m);
  return match ? match[1] === 'true' : true;
}

export function setWorkersDevEnabled(toml, enabled) {
  const cut = preambleEnd(toml);
  const preamble = toml.slice(0, cut);
  const line = `workers_dev = ${enabled}`;
  if (/^workers_dev\s*=/m.test(preamble)) {
    return preamble.replace(/^workers_dev\s*=\s*(true|false)/m, line) + toml.slice(cut);
  }
  // Insert right before whatever trailing blank line(s) already separate the preamble from the
  // first `[section]`, so the file's existing spacing style survives instead of collapsing to no
  // blank line at all.
  const trailingNewlines = preamble.match(/\n*$/)[0];
  const base = preamble.slice(0, preamble.length - trailingNewlines.length);
  return `${base}\n${line}${trailingNewlines}` + toml.slice(cut);
}

// A custom-domain route (`[[routes]]` with `custom_domain = true`) can appear anywhere in the
// file — a new `[[section]]` header always closes whatever table was open before it regardless of
// position, so appending one at the very end is always syntactically safe (never risks landing
// inside [vars] or a [[d1_databases]] block).
//
// IMPORTANT, confirmed empirically against a real deploy (not from docs, which claim `workers_dev`
// defaults to `true` unconditionally — that's wrong once any `routes` config exists): the moment a
// wrangler.toml gains a `[[routes]]` entry, wrangler's own default for an *absent* `workers_dev`
// flips from enabled to **disabled** ("Because 'workers_dev' is not in your Wrangler file, it will
// be disabled for this deployment by default"). configureDomain() in configure.mjs accounts for
// this by explicitly writing `workers_dev = true` right after adding the first route, unless the
// developer separately confirms they want it disabled — never leaving it implicit once routes
// exist, since implicit now means "off," not "on."
export function readCustomDomainRoutes(toml) {
  const patterns = [];
  const routeBlockRe = /\[\[routes\]\][^[]*/g;
  let match;
  while ((match = routeBlockRe.exec(toml))) {
    if (/custom_domain\s*=\s*true/.test(match[0])) {
      const pattern = extractTomlValue(match[0], 'pattern');
      if (pattern) patterns.push(pattern);
    }
  }
  return patterns;
}

export function addCustomDomainRoute(toml, pattern) {
  if (readCustomDomainRoutes(toml).includes(pattern)) return toml;
  return toml.replace(/\n*$/, '') + `\n\n[[routes]]\npattern = "${pattern}"\ncustom_domain = true\n`;
}
