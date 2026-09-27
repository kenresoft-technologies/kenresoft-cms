// Pure helpers for Kenresoft CMS release versioning, shared by scripts/release.mjs (cutting a
// release) and scripts/lib/git-cli.mjs (`pnpm run update` following release tags). No git, no
// filesystem, no network — everything here is unit-tested directly (versioning.test.mjs).
//
// One version for the whole CMS (root, apps/api and apps/admin package.json), released as a git
// tag `vX.Y.Z` with a matching `## [X.Y.Z] - YYYY-MM-DD` section in CHANGELOG.md. The published
// npm packages (@kenresoft-cms/contracts, astro, create) keep their own independent versions.
// Semver rules for what counts as major/minor/patch are in docs/RELEASING.md.

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

// Returns { major, minor, patch, prerelease } or null for anything that isn't a plain semver
// version (optionally `v`-prefixed). Build metadata (`+...`) is deliberately not accepted.
export function parseVersion(value) {
  const match = SEMVER.exec(String(value ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function formatVersion({ major, minor, patch, prerelease }) {
  return `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`;
}

// Semver precedence: a prerelease sorts before its release (1.0.0-rc.1 < 1.0.0). Prerelease
// identifiers are compared as a whole string here, which is enough for the rc.N / beta.N tags
// this project would use; releases themselves never carry one.
export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  if (!left || !right) throw new Error(`Cannot compare invalid versions "${a}" and "${b}".`);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true });
}

// The next version for a `pnpm run release <kind>` — `patch`/`minor`/`major`, or an explicit
// `X.Y.Z`, which must be greater than the current one.
export function nextVersion(current, kind) {
  const parsed = parseVersion(current);
  if (!parsed) throw new Error(`The current version "${current}" is not a valid semver version.`);
  let next;
  if (kind === 'major') next = { major: parsed.major + 1, minor: 0, patch: 0, prerelease: null };
  else if (kind === 'minor') next = { major: parsed.major, minor: parsed.minor + 1, patch: 0, prerelease: null };
  else if (kind === 'patch') next = { ...parsed, patch: parsed.patch + 1, prerelease: null };
  else {
    const explicit = parseVersion(kind);
    if (!explicit) throw new Error(`"${kind}" is not patch, minor, major or a version like 0.9.0.`);
    next = explicit;
  }
  if (compareVersions(next, parsed) <= 0) {
    throw new Error(`${formatVersion(next)} is not newer than the current version ${formatVersion(parsed)}.`);
  }
  return formatVersion(next);
}

// The newest stable release among a list of git tag names (`v0.9.0`, `v0.10.1`, ...), or null.
// Prerelease tags and anything that isn't a `v`-prefixed version are ignored, so a stray tag
// can never be picked up as a release by `pnpm run update`.
export function latestReleaseTag(tags) {
  let best = null;
  for (const tag of tags) {
    if (!tag.startsWith('v')) continue;
    const parsed = parseVersion(tag);
    if (!parsed || parsed.prerelease) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { tag, parsed };
  }
  return best?.tag ?? null;
}

const UNRELEASED_HEADING = /^## Unreleased[ \t]*$/m;
// A function, not a shared /g constant: a global regex carries lastIndex between calls (and
// matchAll copies it), which silently skipped the first section after an earlier search.
const sectionHeading = () => /^## \[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:[ \t].*)?$/gm;

// Moves everything under `## Unreleased` into a new `## [version] - date` section and leaves an
// empty `## Unreleased` above it. Throws if there's nothing to release, so a release can never
// ship with empty notes.
export function rotateChangelog(changelog, version, date) {
  const match = UNRELEASED_HEADING.exec(changelog);
  if (!match) throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  const bodyStart = match.index + match[0].length;
  const heading = sectionHeading();
  heading.lastIndex = bodyStart;
  const nextSection = heading.exec(changelog);
  const bodyEnd = nextSection ? nextSection.index : changelog.length;
  const body = changelog.slice(bodyStart, bodyEnd).trim();
  if (!body) throw new Error('CHANGELOG.md\'s "## Unreleased" section is empty — nothing to release.');
  return (
    `${changelog.slice(0, match.index)}## Unreleased\n\n## [${version}] - ${date}\n\n${body}\n` +
    (nextSection ? `\n${changelog.slice(bodyEnd)}` : '')
  );
}

// Every `## [X.Y.Z]` section's version and body, newest first (file order).
function changelogSections(changelog) {
  const sections = [];
  const headings = [...changelog.matchAll(sectionHeading())];
  headings.forEach((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : changelog.length;
    // Stop at a following `## Unreleased` too, though by convention it's always first.
    const body = changelog.slice(start, end).split(UNRELEASED_HEADING)[0].trim();
    sections.push({ version: heading[1], heading: heading[0], body });
  });
  return sections;
}

// The body of one version's section (the GitHub release notes), or null.
export function changelogSection(changelog, version) {
  return changelogSections(changelog).find((section) => section.version === version)?.body ?? null;
}

// The sections released after `fromVersion` up to and including `toVersion`, newest first,
// each with its heading — what an update from one version to another brings.
export function changelogBetween(changelog, fromVersion, toVersion) {
  return changelogSections(changelog)
    .filter(
      (section) =>
        compareVersions(section.version, toVersion) <= 0 &&
        (!fromVersion || !parseVersion(fromVersion) || compareVersions(section.version, fromVersion) > 0),
    )
    .map((section) => `${section.heading}\n\n${section.body}`)
    .join('\n\n');
}
