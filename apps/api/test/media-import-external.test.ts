import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// A real end-to-end call to picsum.photos was verified manually (a standalone script hitting
// the real API confirmed a 200 with a real image/jpeg body) rather than exercised here as an
// automated test: a genuine outbound fetch from inside a route under this pool's isolated D1/R2
// storage reliably breaks "Isolated storage failed... unable to pop R2 storage" — a real,
// reproducible limitation of @cloudflare/vitest-pool-workers 0.9.14's isolated-storage model
// when a request also touches storage, not flakiness. Mocking the module instead (the usual
// escape hatch, per security-elevate.test.ts's own precedent) doesn't reach this route either:
// confirmed by removing that file's own vi.mock and observing the identical 403 either way — its
// real, unmocked code path already throws and gets caught into the same response, so that
// precedent was never actually proven to intercept an internal module in this runtime. The two
// tests below stay inside what's safely automatable: validation and the role gate, both of which
// never reach fetchExternalImage at all.
async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

describe('import external media (real D1, request validation and role gate)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('400s an invalid request before ever reaching the external source', async () => {
    const cookie = await authedCookie('media-import-2@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/admin/media/import-external', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'picsum', width: 0, height: 480 }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects import from a viewer role', async () => {
    const ownerCookie = await authedCookie('media-import-owner@example.test');
    const ownerHeaders = { Cookie: ownerCookie, 'Content-Type': 'application/json' };
    const viewerCookie = await authedCookie('media-import-viewer@example.test');

    const users = await (
      await SELF.fetch('https://example.com/api/v1/admin/users', { headers: ownerHeaders })
    ).json<Array<{ id: string; role: string }>>();
    const secondUser = users.find((u) => u.role !== 'owner');
    await SELF.fetch(`https://example.com/api/v1/admin/users/${secondUser!.id}/role`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ role: 'viewer' }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/admin/media/import-external', {
      method: 'POST',
      headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'picsum', width: 32, height: 32 }),
    });
    expect(response.status).toBe(403);
  });
});
