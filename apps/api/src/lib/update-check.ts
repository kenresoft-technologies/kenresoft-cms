import type { LatestRelease } from '@kenresoft-cms/contracts';

// "Is there a newer Kenresoft CMS release?" for the admin UI (routes/admin/system.ts). Asked from
// the API Worker, not the browser, so the admin's Content-Security-Policy never has to allow
// GitHub. Unauthenticated GitHub API calls are limited to 60 an hour per IP — and Workers share
// egress IPs — so the answer is edge-cached for hours, a failure is cached too (shorter), and the
// request has a short timeout. Any failure just means "unknown": it never breaks the admin UI.

export const DEFAULT_UPDATE_CHECK_REPO = 'kenresoft-technologies/kenresoft-cms';
const SUCCESS_TTL_SECONDS = 6 * 60 * 60;
const FAILURE_TTL_SECONDS = 60 * 60;
const FETCH_TIMEOUT_MS = 5000;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// UPDATE_CHECK_REPO: unset = the upstream Kenresoft CMS repo; "owner/repo" = a fork that publishes
// its own releases; "off"/"false"/"" = no check at all. Anything malformed is treated as off
// rather than being put into a URL.
export function updateCheckRepo(value: string | undefined): string | null {
  if (value === undefined) return DEFAULT_UPDATE_CHECK_REPO;
  const trimmed = value.trim();
  if (!trimmed || ['off', 'false', 'no', '0'].includes(trimmed.toLowerCase())) return null;
  return REPO_PATTERN.test(trimmed) ? trimmed : null;
}

// GitHub's "latest release" response → what the admin needs. Drafts and prereleases are never
// offered as an update (GitHub's /releases/latest already excludes them; checked anyway).
export function parseLatestRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== 'object') return null;
  const release = body as Record<string, unknown>;
  if (release['draft'] === true || release['prerelease'] === true) return null;
  const tag = release['tag_name'];
  const url = release['html_url'];
  if (typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(tag) || typeof url !== 'string' || !url.startsWith('https://github.com/')) {
    return null;
  }
  const publishedAt = release['published_at'];
  return { version: tag.replace(/^v/, ''), url, publishedAt: typeof publishedAt === 'string' ? publishedAt : null };
}

function cacheKey(repo: string): Request {
  return new Request(`https://update-check.internal/${repo}`, { method: 'GET' });
}

export async function fetchLatestRelease(
  repo: string,
  fetchImpl: typeof fetch = fetch,
  cache: Cache = caches.default,
): Promise<LatestRelease | null> {
  const key = cacheKey(repo);
  const cached = await cache.match(key);
  if (cached) return parseCachedRelease(await cached.json());

  let release: LatestRelease | null = null;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kenresoft-cms-update-check' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.ok) release = parseLatestRelease(await response.json());
    else await response.body?.cancel();
  } catch {
    release = null;
  }

  const ttl = release ? SUCCESS_TTL_SECONDS : FAILURE_TTL_SECONDS;
  await cache.put(
    key,
    new Response(JSON.stringify({ release }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
    }),
  );
  return release;
}

function parseCachedRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== 'object' || !('release' in body)) return null;
  const release = (body as { release: unknown }).release;
  if (!release || typeof release !== 'object') return null;
  const { version, url, publishedAt } = release as Record<string, unknown>;
  if (typeof version !== 'string' || typeof url !== 'string') return null;
  return { version, url, publishedAt: typeof publishedAt === 'string' ? publishedAt : null };
}
