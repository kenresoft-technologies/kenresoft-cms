import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: cookie } });
  const body = await response.json<{ user: { id: string } }>();
  return body.user.id;
}

async function setRole(adminCookie: string, targetId: string, role: string): Promise<void> {
  await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

async function createContactForm(cookie: string, notificationEmails?: string[]) {
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const form = await (
    await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Contact', slug: 'contact', notificationEmails: notificationEmails ?? null }),
    })
  ).json<{ id: string }>();

  await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'name', label: 'Name', fieldType: 'text', required: true }),
  });
  await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'email', label: 'Email', fieldType: 'email', required: true }),
  });

  return form;
}

describe('admin form test-submissions (Preview & Test, real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media_attachments');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM form_submissions');
    await env.DB.exec('DELETE FROM form_fields');
    await env.DB.exec('DELETE FROM forms');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
    clearTestEmails();
  });

  it('creates a real submission flagged isTest, excluded from nothing structurally but visible in the inbox', async () => {
    const cookie = await authedCookie('form-test-admin@example.test');
    const form = await createContactForm(cookie);

    const body = new FormData();
    body.set('name', 'Jane Doe');
    body.set('email', 'jane@example.test');

    const response = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/test-submissions`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body,
    });
    expect(response.status).toBe(201);
    const submission = await response.json<{ id: string; isTest: boolean }>();
    expect(submission.isTest).toBe(true);

    const list = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, { headers: { Cookie: cookie } })
    ).json<{ id: string; isTest: boolean }[]>();
    expect(list.find((s) => s.id === submission.id)?.isTest).toBe(true);
  });

  it('runs the same validation as a real submission — rejects a missing required field', async () => {
    const cookie = await authedCookie('form-test-validation-admin@example.test');
    const form = await createContactForm(cookie);

    const body = new FormData();
    body.set('name', 'Jane Doe');
    // email omitted, required

    const response = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/test-submissions`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('sends the configured notification email, prefixed as a test', async () => {
    const cookie = await authedCookie('form-test-notify-admin@example.test');
    const form = await createContactForm(cookie, ['ops@example.test']);

    const body = new FormData();
    body.set('name', 'Jane Doe');
    body.set('email', 'jane@example.test');

    const response = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/test-submissions`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body,
    });
    expect(response.status).toBe(201);

    const emails = getTestEmails().filter((e) => e.to === 'ops@example.test');
    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toContain('[Test]');
  });

  it('rejects a viewer, and rejects an author entirely (same floor as managing fields)', async () => {
    const ownerCookie = await authedCookie('form-test-role-owner@example.test');
    const form = await createContactForm(ownerCookie);

    const viewerCookie = await authedCookie('form-test-role-viewer@example.test');
    await setRole(ownerCookie, await userId(viewerCookie), 'viewer');
    const authorCookie = await authedCookie('form-test-role-author@example.test');
    await setRole(ownerCookie, await userId(authorCookie), 'author');

    const body = new FormData();
    body.set('name', 'Jane Doe');
    body.set('email', 'jane@example.test');

    const viewerResponse = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/test-submissions`, {
      method: 'POST',
      headers: { Cookie: viewerCookie },
      body,
    });
    expect(viewerResponse.status).toBe(403);

    const authorResponse = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/test-submissions`, {
      method: 'POST',
      headers: { Cookie: authorCookie },
      body,
    });
    expect(authorResponse.status).toBe(403);
  });

  it('404s for a nonexistent form', async () => {
    const cookie = await authedCookie('form-test-missing-admin@example.test');
    const body = new FormData();
    body.set('name', 'Jane Doe');

    const response = await SELF.fetch('https://example.com/api/v1/admin/forms/does-not-exist/test-submissions', {
      method: 'POST',
      headers: { Cookie: cookie },
      body,
    });
    expect(response.status).toBe(404);
  });
});
