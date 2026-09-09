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
