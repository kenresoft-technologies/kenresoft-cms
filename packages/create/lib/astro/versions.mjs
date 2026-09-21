// Tiny semver helpers + npm registry lookup. Deliberately not the `semver` package: this CLI has
// zero runtime dependencies (it runs via npx), and we only need x.y.z ordering and a major check.
export const CLIENT_PACKAGE = '@kenresoft-cms/astro';
// createCmsProxy() and client.auth (everything the managed files use) first shipped in 0.5.x.
export const MIN_CLIENT_VERSION = '0.5.1';
export const MIN_ASTRO_MAJOR = 5;

export function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/.exec(String(text ?? ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, text: m[0] };
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Cannot compare versions "${a}" and "${b}"`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** Lowest version a range like "^0.3.0" / "~1.2.3" / "1.2.3" can resolve to (or null). */
export function rangeFloor(range) {
  return parseVersion(range)?.text ?? null;
}

/** Does an `astro` peer range mention the given major? (Loose on purpose: "^5 || ^6 || ^7".) */
export function peerAllowsAstroMajor(peerRange, major) {
  if (!peerRange) return true;
  const majors = [...String(peerRange).matchAll(/(\d+)(?:\.\d+)*/g)].map((m) => +m[1]);
  if (majors.length === 0) return true;
  if (/>=/.test(peerRange)) return major >= Math.min(...majors);
  return majors.includes(major);
}

/**
 * Newest stable published version that is >= our minimum and whose `astro` peer range (if any)
 * allows the project's Astro major. `meta` is the registry document. Returns null if none.
 *
 * This is explicit on purpose: under 0.x a range like ^0.3.0 never crosses to 0.4.0, so we
 * cannot lean on the package manager's normal caret resolution to reach a newer minor.
 */
export function pickCompatibleVersion(meta, astroMajor) {
  const versions = Object.entries(meta?.versions ?? {})
    .filter(([v]) => parseVersion(v) && !parseVersion(v).pre && compareVersions(v, MIN_CLIENT_VERSION) >= 0)
    .filter(([, info]) => peerAllowsAstroMajor(info?.peerDependencies?.astro, astroMajor))
    .map(([v]) => v)
    .sort(compareVersions);
  return versions.at(-1) ?? null;
}

export async function fetchClientMetadata() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${CLIENT_PACKAGE.replace(/\//g, '%2F')}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
