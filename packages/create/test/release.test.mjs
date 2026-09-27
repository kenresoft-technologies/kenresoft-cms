import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { latestReleaseTag } from '../lib/release.mjs';

describe('latestReleaseTag', () => {
  it('picks the highest vX.Y.Z by number, not by string order', () => {
    assert.equal(latestReleaseTag(['v0.9.0', 'v0.10.0', 'v0.9.12']), 'v0.10.0');
    assert.equal(latestReleaseTag(['v1.0.0', 'v0.99.99']), 'v1.0.0');
  });

  it('ignores prereleases and tags that are not releases', () => {
    assert.equal(latestReleaseTag(['v0.9.0', 'v0.10.0-beta.1', 'backup', '0.11.0', 'v0.12']), 'v0.9.0');
  });

  it('returns null when there are no releases', () => {
    assert.equal(latestReleaseTag([]), null);
    assert.equal(latestReleaseTag(['v1.0.0-rc.1', 'something']), null);
  });
});
