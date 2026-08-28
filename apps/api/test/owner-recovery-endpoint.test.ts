import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { systemRoute } from '../src/routes/system/recover-owner';
import type { Bindings } from '../src/lib/env';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';
// Matches vitest.config.ts's miniflare bindings override — a plain string var, unlike D1/R2,
// is baked into the Worker at Miniflare startup, so this test suite runs with the feature
// permanently enabled rather than being able to toggle it per-test via env.* mutation.
const CONFIGURED_SECRET = 'test-only-owner-recovery-secret-not-used-outside-vitest-pool-workers';

async function signUp(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function recoverOwner(body: Record<string, unknown>) {
  return SELF.fetch('https://example.com/api/v1/system/recover-owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('break-glass owner recovery — not configured', () => {
  it('404s outright when OWNER_RECOVERY_SECRET is absent from Bindings entirely', async () => {
    const bareEnv = {} as Bindings;
    const response = await systemRoute.request(
      '/recover-owner',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'anything', email: 'nobody@pathvera.test', newPassword: NEW_PASSWORD }),
      },
      bareEnv,
    );
    expect(response.status).toBe(404);
  });
});

describe('break-glass owner recovery — configured (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects the wrong secret', async () => {
    await signUp('recover-owner-2@pathvera.test');
    const response = await recoverOwner({
      secret: 'not-the-real-secret',
      email: 'recover-owner-2@pathvera.test',
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(403);
  });

  it('rejects a non-owner email even with the correct secret', async () => {
    await signUp('recover-owner-3-owner@pathvera.test');
    // Second signup defaults to editor, not owner — the fixture's target.
    await signUp('recover-owner-3-editor@pathvera.test');

    const response = await recoverOwner({
      secret: CONFIGURED_SECRET,
      email: 'recover-owner-3-editor@pathvera.test',
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(404);
  });

  it('resets the owner password and signs out every session, given the correct secret', async () => {
    const ownerCookie = await signUp('recover-owner-4@pathvera.test');

    const response = await recoverOwner({
      secret: CONFIGURED_SECRET,
      email: 'recover-owner-4@pathvera.test',
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);

    const staleCheck = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
      headers: { Cookie: ownerCookie },
    });
    expect(await staleCheck.json()).toBeNull();

    const newPasswordSignIn = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'recover-owner-4@pathvera.test', password: NEW_PASSWORD }),
    });
    expect(newPasswordSignIn.status).toBe(200);

    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'owner.recovered'").first();
    expect(audit).not.toBeNull();
  });
});
