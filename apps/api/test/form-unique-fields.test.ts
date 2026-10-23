import { SELF, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkFormHumanVerification } from '../src/middleware/turnstile';
import type { Bindings } from '../src/lib/env';
import { buildDedupeKey } from '../src/lib/submit-form';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { startInFreshRateLimitWindow } from './helpers/rate-limit';

async function createWaitlistForm(cookie: string, extra: Record<string, unknown> = {}) {
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const form = await (
    await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'App waitlist', slug: 'app-waitlist', ...extra }),
    })
  ).json<{ id: string }>();
  for (const field of [
    { name: 'app', label: 'App', fieldType: 'text', required: true },
    { name: 'email', label: 'Email', fieldType: 'email', required: true },
  ]) {
    await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
      method: 'POST',
      headers,
      body: JSON.stringify(field),
    });
  }
  return form;
}

// Each test uses its own client IP so they do not share the per-IP submission rate limit.
const submit = (body: unknown, ip: string) =>
  SELF.fetch('https://example.com/api/v1/public/forms/app-waitlist/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });

const owner = (email: string) =>
  signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Owner' });

describe('form unique fields (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM form_submissions');
    await env.DB.exec('DELETE FROM form_fields');
    await env.DB.exec('DELETE FROM forms');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('refuses a repeat of the same app and email (any letter case) but allows another app or email', async () => {
    const form = await createWaitlistForm(await owner('unique-owner@example.test'), {
      uniqueFields: ['app', 'email'],
    });
    expect(form.id).toBeTruthy();
    await startInFreshRateLimitWindow();

    const first = await submit({ app: 'quickresponse', email: ' Visitor@Example.com ' }, '198.51.100.1');
    expect(first.status).toBe(201);
    // The address is stored trimmed and lowercased.
    expect(((await first.json()) as { data: { email: string } }).data.email).toBe('visitor@example.com');

    expect((await submit({ app: 'quickresponse', email: 'visitor@example.COM' }, '198.51.100.1')).status).toBe(409);
    expect((await submit({ app: 'coxprice', email: 'visitor@example.com' }, '198.51.100.1')).status).toBe(201);
    expect((await submit({ app: 'quickresponse', email: 'other@example.com' }, '198.51.100.1')).status).toBe(201);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_submissions').first<{ n: number }>();
    expect(count?.n).toBe(3);
  });

  it('allows duplicates on a form without uniqueFields (existing behavior)', async () => {
    await createWaitlistForm(await owner('unique-owner2@example.test'));
    await startInFreshRateLimitWindow();

    expect((await submit({ app: 'a', email: 'same@example.com' }, '198.51.100.2')).status).toBe(201);
    expect((await submit({ app: 'a', email: 'same@example.com' }, '198.51.100.2')).status).toBe(201);
  });

  it('keeps submissions off the public API and behind sign-in in the admin API', async () => {
    const form = await createWaitlistForm(await owner('unique-owner3@example.test'), {
      uniqueFields: ['app', 'email'],
    });
    await startInFreshRateLimitWindow();
    await submit({ app: 'a', email: 'private@example.com' }, '198.51.100.3');

    expect((await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`)).status).toBe(401);
    const publicList = await SELF.fetch('https://example.com/api/v1/public/forms/app-waitlist/submissions');
    expect(publicList.status).not.toBe(200);
  });
});

describe('buildDedupeKey', () => {
  it('is null with no rule or for a test submission', () => {
    expect(buildDedupeKey(null, { email: 'a@b.c' }, false)).toBeNull();
    expect(buildDedupeKey([], { email: 'a@b.c' }, false)).toBeNull();
    expect(buildDedupeKey(['email'], { email: 'a@b.c' }, true)).toBeNull();
  });

  it('normalizes case and whitespace and keeps field order', () => {
    expect(buildDedupeKey(['app', 'email'], { app: ' App ', email: 'A@B.C' }, false)).toBe('app\u0000a@b.c');
    expect(buildDedupeKey(['app', 'missing'], { app: 'x' }, false)).toBe('x\u0000');
  });
});

describe('form human check', () => {
  afterEach(() => vi.restoreAllMocks());

  const app = () => {
    const a = new Hono<{ Bindings: Bindings }>();
    a.post('/', async (c) => (await checkFormHumanVerification(c)) ?? c.json({ ok: true }));
    return a;
  };
  const call = (envVars: Partial<Bindings>, headers: Record<string, string> = {}) =>
    app().request('https://example.com/', { method: 'POST', headers }, envVars as Bindings);

  it('does nothing when TURNSTILE_SECRET_KEY is not set', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await call({})).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('requires a token when the secret is set, and checks it with Cloudflare', async () => {
    expect((await call({ TURNSTILE_SECRET_KEY: 's' })).status).toBe(400);

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true })));
    expect((await call({ TURNSTILE_SECRET_KEY: 's' }, { 'x-turnstile-token': 'tok' })).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockResolvedValue(new Response(JSON.stringify({ success: false })));
    expect((await call({ TURNSTILE_SECRET_KEY: 's' }, { 'x-turnstile-token': 'bad' })).status).toBe(403);

    spy.mockRejectedValue(new Error('network'));
    expect((await call({ TURNSTILE_SECRET_KEY: 's' }, { 'x-turnstile-token': 'tok' })).status).toBe(503);
  });
});
