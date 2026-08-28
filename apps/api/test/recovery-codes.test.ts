import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function elevate(cookie: string, password = PASSWORD) {
  return SELF.fetch('https://example.com/api/v1/admin/security/elevate', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

async function generateCodes(cookie: string) {
  return SELF.fetch('https://example.com/api/v1/admin/security/recovery-codes/generate', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
}

async function revokeCodes(cookie: string) {
  return SELF.fetch('https://example.com/api/v1/admin/security/recovery-codes', {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

async function codesStatus(cookie: string) {
  return SELF.fetch('https://example.com/api/v1/admin/security/recovery-codes', {
    headers: { Cookie: cookie },
  });
}

async function redeem(email: string, code: string, newPassword = NEW_PASSWORD) {
  return SELF.fetch('https://example.com/api/v1/public/recovery/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, newPassword }),
  });
}

describe('recovery codes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM recovery_code');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('requires elevation, even for the owner', async () => {
    const ownerCookie = await authedCookie('rc-owner-1@pathvera.test');
    const response = await generateCodes(ownerCookie);
    expect(response.status).toBe(403);
  });

  it('rejects a non-owner outright, before elevation is even checked', async () => {
    const ownerCookie = await authedCookie('rc-owner-2@pathvera.test');
    const adminCookie = await authedCookie('rc-admin-2@pathvera.test');
    // Second signup defaults to editor — promote to admin so this is specifically an
    // admin-vs-owner check, not editor-vs-owner.
    const adminSession = await (
      await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: adminCookie } })
    ).json<{ user: { id: string } }>();
    await SELF.fetch(`https://example.com/api/v1/admin/users/${adminSession.user.id}/role`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    const response = await generateCodes(adminCookie);
    expect(response.status).toBe(403);
  });

  it('generates codes for the owner once elevated, and reports how many remain', async () => {
    const ownerCookie = await authedCookie('rc-owner-3@pathvera.test');
    await elevate(ownerCookie);

    const response = await generateCodes(ownerCookie);
    expect(response.status).toBe(200);
    const body = await response.json<{ codes: string[] }>();
    expect(body.codes).toHaveLength(10);
    expect(new Set(body.codes).size).toBe(10);

    const status = await (await codesStatus(ownerCookie)).json<{ remaining: number }>();
    expect(status.remaining).toBe(10);
  });

  it('regenerating invalidates every previous code', async () => {
    const ownerCookie = await authedCookie('rc-owner-4@pathvera.test');
    await elevate(ownerCookie);
    const first = await (await generateCodes(ownerCookie)).json<{ codes: string[] }>();

    await elevate(ownerCookie);
    await generateCodes(ownerCookie);

    const response = await redeem('rc-owner-4@pathvera.test', first.codes[0]!);
    expect(response.status).toBe(400);
  });

  it('revokes every code without issuing new ones', async () => {
    const ownerCookie = await authedCookie('rc-owner-5@pathvera.test');
    await elevate(ownerCookie);
    await generateCodes(ownerCookie);

    await elevate(ownerCookie);
    const revokeResponse = await revokeCodes(ownerCookie);
    expect(revokeResponse.status).toBe(200);

    const status = await (await codesStatus(ownerCookie)).json<{ remaining: number }>();
    expect(status.remaining).toBe(0);
  });

  it('redeems a valid code, resets the password, and signs out every session', async () => {
    const ownerCookie = await authedCookie('rc-owner-6@pathvera.test');
    await elevate(ownerCookie);
    const { codes } = await (await generateCodes(ownerCookie)).json<{ codes: string[] }>();

    const response = await redeem('rc-owner-6@pathvera.test', codes[0]!);
    expect(response.status).toBe(200);

    const sessionsAfter = await env.DB.prepare('SELECT count(*) as n FROM session').first<{ n: number }>();
    expect(sessionsAfter?.n).toBe(0);

    const newPasswordSignIn = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rc-owner-6@pathvera.test', password: NEW_PASSWORD }),
    });
    expect(newPasswordSignIn.status).toBe(200);
  });

  it('is single-use — the same code cannot be redeemed twice', async () => {
    const ownerCookie = await authedCookie('rc-owner-7@pathvera.test');
    await elevate(ownerCookie);
    const { codes } = await (await generateCodes(ownerCookie)).json<{ codes: string[] }>();

    const first = await redeem('rc-owner-7@pathvera.test', codes[0]!);
    expect(first.status).toBe(200);

    const second = await redeem('rc-owner-7@pathvera.test', codes[0]!, 'yet another passphrase');
    expect(second.status).toBe(400);
  });

  it('rejects a wrong code or a wrong email with the same generic error', async () => {
    const ownerCookie = await authedCookie('rc-owner-8@pathvera.test');
    await elevate(ownerCookie);
    await generateCodes(ownerCookie);

    const wrongCode = await redeem('rc-owner-8@pathvera.test', 'ZZZZZ-ZZZZZ');
    const wrongEmail = await redeem('no-such-user@pathvera.test', 'ZZZZZ-ZZZZZ');

    expect(wrongCode.status).toBe(400);
    expect(wrongEmail.status).toBe(400);
    expect(await wrongCode.json()).toEqual(await wrongEmail.json());
  });
});
