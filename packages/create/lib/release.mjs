// Picks the newest stable release tag (vX.Y.Z) from a list of tag names, or null when there is
// none. Mirrors latestReleaseTag() in the CMS repo's scripts/lib/versioning.mjs, which this
// published package can't import: prereleases and any tag not shaped vX.Y.Z are ignored.
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function isNewer(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function latestReleaseTag(tags) {
  let best = null;
  let bestParts = null;
  for (const raw of tags) {
    const tag = raw.trim();
    const match = RELEASE_TAG.exec(tag);
    if (!match) continue;
    const parts = match.slice(1).map(Number);
    if (!bestParts || isNewer(parts, bestParts)) {
      best = tag;
      bestParts = parts;
    }
  }
  return best;
}
