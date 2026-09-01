import { describe, expect, it, vi } from 'vitest';

// Calling better-auth's `api.verifyPassword()` directly (a server-side call, not through
// `.handler(request)`) with a wrong password triggers an unhandled promise rejection somewhere
// inside better-auth/better-call's internals, independent of the APIError this route's own
// try/catch already correctly maps to a 403 — confirmed by that assertion passing here and in
// the real-D1 integration tests, while Vitest's own runner still reports "1 unhandled error"
// and fails the whole file (and, on CI, the whole `vitest run` process) regardless. Reproduced
// identically on both Windows and Linux CI, so it's a runtime/library quirk, not an environment
// one. Mocking createAuth avoids exercising that internal code path at all, while still testing
// this route's own error-handling — the actual real-D1, real-better-auth "wrong password is
// rejected" behavior stays covered by owner-protection.test.ts's other assertions (elevation
// never granted without it) and ownership-transfer.test.ts (elevation actually works when the
// password is correct).
vi.mock('../src/lib/auth', () => ({
  createAuth: vi.fn(() => ({
    api: {
      verifyPassword: vi.fn().mockRejectedValue(new Error('Invalid password')),
    },
  })),
}));

const { securityRoute } = await import('../src/routes/admin/security');

describe('POST /security/elevate (mocked better-auth)', () => {
  it('returns 403 without touching the session when the password is wrong', async () => {
    const response = await securityRoute.request('/elevate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'definitely wrong' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Incorrect password' });
  });
});
