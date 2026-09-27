import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changelogBetween,
  changelogSection,
  compareVersions,
  latestReleaseTag,
  nextVersion,
  parseVersion,
  rotateChangelog,
} from './versioning.mjs';

test('parseVersion accepts plain and v-prefixed semver, rejects anything else', () => {
  assert.deepEqual(parseVersion('v0.9.0'), { major: 0, minor: 9, patch: 0, prerelease: null });
  assert.deepEqual(parseVersion('1.2.3-rc.1'), { major: 1, minor: 2, patch: 3, prerelease: 'rc.1' });
  for (const bad of ['', '1.2', '01.2.3', 'v1.2.3.4', 'latest', '1.2.3+build', null, undefined]) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
});

test('compareVersions orders numerically, with a prerelease before its release', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  assert.throws(() => compareVersions('nope', '1.0.0'));
});

test('nextVersion bumps by kind or takes an explicit, newer version', () => {
  assert.equal(nextVersion('0.9.3', 'patch'), '0.9.4');
  assert.equal(nextVersion('0.9.3', 'minor'), '0.10.0');
  assert.equal(nextVersion('0.9.3', 'major'), '1.0.0');
  assert.equal(nextVersion('0.1.0', '0.9.0'), '0.9.0');
  assert.equal(nextVersion('1.0.0-rc.1', 'patch'), '1.0.1');
  assert.throws(() => nextVersion('0.9.0', '0.9.0'), /not newer/);
  assert.throws(() => nextVersion('0.9.0', '0.8.0'), /not newer/);
  assert.throws(() => nextVersion('0.9.0', 'huge'), /not patch, minor, major/);
});

test('latestReleaseTag picks the highest stable v-tag and ignores everything else', () => {
  assert.equal(latestReleaseTag(['v0.9.0', 'v0.10.0', 'v0.9.12']), 'v0.10.0');
  assert.equal(latestReleaseTag(['v1.0.0-rc.1', 'v0.9.0']), 'v0.9.0');
  assert.equal(latestReleaseTag(['0.99.0', 'release-1', 'v0.9.0']), 'v0.9.0');
  assert.equal(latestReleaseTag([]), null);
  assert.equal(latestReleaseTag(['v2.0.0-beta.1']), null);
});

const CHANGELOG = `# Changelog

Intro text.

## Unreleased

### Added

- New thing.

### Fixed

- A bug.

## [0.9.1] - 2026-10-01

### Fixed

- Older fix.

## [0.9.0] - 2026-09-26

### Added

- First release.
`;

test('rotateChangelog moves Unreleased into a dated version section, leaving an empty Unreleased', () => {
  const rotated = rotateChangelog(CHANGELOG, '0.9.2', '2026-10-05');
  assert.match(rotated, /## Unreleased\n\n## \[0\.9\.2\] - 2026-10-05\n\n### Added\n\n- New thing\.\n\n### Fixed\n\n- A bug\.\n\n## \[0\.9\.1\]/);
  assert.equal(changelogSection(rotated, '0.9.2'), '### Added\n\n- New thing.\n\n### Fixed\n\n- A bug.');
  // The older sections are untouched.
  assert.equal(changelogSection(rotated, '0.9.0'), '### Added\n\n- First release.');
  // Releasing again right away has nothing to release.
  assert.throws(() => rotateChangelog(rotated, '0.9.3', '2026-10-06'), /empty/);
});

test('rotateChangelog works on a changelog with no released sections yet', () => {
  const first = '# Changelog\n\n## Unreleased\n\n### Added\n\n- Everything so far.\n';
  const rotated = rotateChangelog(first, '0.9.0', '2026-09-26');
  assert.equal(rotated, '# Changelog\n\n## Unreleased\n\n## [0.9.0] - 2026-09-26\n\n### Added\n\n- Everything so far.\n');
  assert.throws(() => rotateChangelog('# Changelog\n', '0.9.0', '2026-09-26'), /no "## Unreleased"/);
});

test('changelogBetween returns what an update from one version to another brings, newest first', () => {
  const notes = changelogBetween(CHANGELOG, '0.9.0', '0.9.1');
  assert.equal(notes, '## [0.9.1] - 2026-10-01\n\n### Fixed\n\n- Older fix.');
  assert.match(changelogBetween(CHANGELOG, null, '0.9.1'), /0\.9\.1[\s\S]*0\.9\.0/);
  assert.equal(changelogBetween(CHANGELOG, '0.9.1', '0.9.1'), '');
  assert.equal(changelogSection(CHANGELOG, '9.9.9'), null);
});
