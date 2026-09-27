import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import rootPackage from '../../../package.json';
import { fetchLatestRelease, parseLatestRelease, updateCheckRepo } from '../src/lib/update-check';
import { CMS_VERSION, compareVersions } from '../src/lib/version';
import { signUpVerifiedAndGetCookie } from './helpers/auth';

// An in-memory stand-in for the Cache API, so the update check's caching can be exercised without
// touching the shared edge cache other tests use.
function memoryCache(): Cache {
  const store = new Map<string, Response>();
  return {
    match: async (request: Request) => store.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => {
      store.set(request.url, response.clone());
    },
  } as unknown as Cache;
}

function githubResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('CMS version and update check', () => {
  it('reports the root package.json version, the single source of truth', () => {
    expect(CMS_VERSION).toBe(rootPackage.version);
  });

  it('compares versions by semver precedence', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v0.9.0', '0.9.0')).toBe(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('latest', '1.0.0')).toBeNull();
  });

  it('reads UPDATE_CHECK_REPO: default upstream, a fork, or off, and never a malformed value', () => {
    expect(updateCheckRepo(undefined)).toBe('kenresoft-technologies/kenresoft-cms');
    expect(updateCheckRepo('acme/cms-fork')).toBe('acme/cms-fork');
    for (const off of ['off', 'OFF', 'false', '', '  ']) expect(updateCheckRepo(off)).toBeNull();
    for (const bad of ['acme', 'acme/cms/extra', '../../etc', 'acme/cms?x=1']) expect(updateCheckRepo(bad)).toBeNull();
  });

  it('only offers a published, stable GitHub release as an update', () => {
    const release = { tag_name: 'v0.9.1', html_url: 'https://github.com/o/r/releases/tag/v0.9.1', published_at: '2026-10-01T00:00:00Z' };
    expect(parseLatestRelease(release)).toEqual({
      version: '0.9.1',
      url: 'https://github.com/o/r/releases/tag/v0.9.1',
      publishedAt: '2026-10-01T00:00:00Z',
    });
    expect(parseLatestRelease({ ...release, prerelease: true })).toBeNull();
    expect(parseLatestRelease({ ...release, draft: true })).toBeNull();
    expect(parseLatestRelease({ ...release, tag_name: 'v1.0.0-rc.1' })).toBeNull();
    expect(parseLatestRelease({ ...release, html_url: 'https://evil.example/x' })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
  });

  it('fetches the latest release once and serves it from cache afterwards', async () => {
    const cache = memoryCache();
    let calls = 0;
    const fakeFetch = (async (url: string) => {
      calls++;
      expect(url).toBe('https://api.github.com/repos/o/r/releases/latest');
      return githubResponse({ tag_name: 'v9.9.9', html_url: 'https://github.com/o/r/releases/tag/v9.9.9' });
    }) as unknown as typeof fetch;

    const first = await fetchLatestRelease('o/r', fakeFetch, cache);
    const second = await fetchLatestRelease('o/r', fakeFetch, cache);
    expect(first).toEqual({ version: '9.9.9', url: 'https://github.com/o/r/releases/tag/v9.9.9', publishedAt: null });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it('treats a GitHub error or network failure as unknown, and caches that too', async () => {
    const cache = memoryCache();
    let calls = 0;
    const failing = (async () => {
      calls++;
      return githubResponse({ message: 'API rate limit exceeded' }, 403);
    }) as unknown as typeof fetch;
    expect(await fetchLatestRelease('o/r', failing, cache)).toBeNull();
    expect(await fetchLatestRelease('o/r', failing, cache)).toBeNull();
    expect(calls).toBe(1);

    const throwing = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    expect(await fetchLatestRelease('o/other', throwing, memoryCache())).toBeNull();
  });

  describe('GET /api/v1/admin/system/version (real D1)', () => {
    beforeEach(async () => {
      await env.DB.exec('DELETE FROM session');
      await env.DB.exec('DELETE FROM account');
      await env.DB.exec('DELETE FROM user');
    });

    it('is for signed-in Admins and Owners only, and reports the check as disabled in tests', async () => {
      const unauthenticated = await SELF.fetch('https://example.com/api/v1/admin/system/version');
      expect(unauthenticated.status).toBe(401);
      await unauthenticated.body?.cancel();

      // The first account is the Owner; a later sign-up has no CMS role.
      const owner = await signUpVerifiedAndGetCookie('version-owner@example.test', {
        password: 'correct horse battery staple',
        name: 'Owner',
      });
      const res = await SELF.fetch('https://example.com/api/v1/admin/system/version', { headers: { Cookie: owner } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        version: rootPackage.version,
        latest: null,
        updateAvailable: false,
        updateCheck: 'disabled',
      });

      const member = await signUpVerifiedAndGetCookie('version-member@example.test', {
        password: 'correct horse battery staple',
        name: 'Member',
      });
      const forbidden = await SELF.fetch('https://example.com/api/v1/admin/system/version', { headers: { Cookie: member } });
      expect(forbidden.status).toBe(403);
      await forbidden.body?.cancel();
    });
  });
});
