// The Kenresoft CMS release this Worker was built from. The root package.json is the single source
// of truth (scripts/release.mjs bumps it), bundled in at build time, so the running version always
// matches the code that was deployed. Not the API contract version (API_VERSION, "v1").
import rootPackage from '../../../../package.json';

export const CMS_VERSION: string = rootPackage.version;

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

// Semver precedence (a prerelease before its release), or null if either side isn't a version.
// Mirrors scripts/lib/versioning.mjs's compareVersions, which the Worker can't import.
export function compareVersions(a: string, b: string): number | null {
  const left = SEMVER.exec(a.trim());
  const right = SEMVER.exec(b.trim());
  if (!left || !right) return null;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  const [leftPre, rightPre] = [left[4] ?? null, right[4] ?? null];
  if (leftPre === rightPre) return 0;
  if (leftPre === null) return 1;
  if (rightPre === null) return -1;
  return Math.sign(leftPre.localeCompare(rightPre, 'en', { numeric: true }));
}
