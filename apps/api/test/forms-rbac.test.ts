import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers: { Cookie: cookie } });
  const body = await response.json<{ user: { id: string } }>();
  return body.user.id;
}

async function setRole(adminCookie: string, targetId: string, role: string) {
  const response = await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  expect(response.status).toBe(200);
}

async function createForm(ownerCookie: string): Promise<{ id: string; slug: string }> {
  const response = await SELF.fetch('https://example.com/api/v1/admin/forms', {
    method: 'POST',
    headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Contact', slug: 'contact' }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

// The Forms/Submissions RBAC matrix (docs/ARCHITECTURE.md §10, requireFormsAccess): Owner/Admin
// full access; Editor editorial access (list/reply/triage); Author NO access at all, not even
// read; Viewer read-only. This deliberately differs from Entries' own role floor, so it's
// tested as its own matrix rather than assumed to follow the same pattern.
describe('Forms/Submissions RBAC (requireFormsAccess)', () => {
  it('owner has full access: create form, list forms, list submissions', async () => {
    const ownerCookie = await authedCookie('forms-rbac-owner@example.test');
    const form = await createForm(ownerCookie);

    const list = await SELF.fetch('https://example.com/api/v1/admin/forms', { headers: { Cookie: ownerCookie } });
    expect(list.status).toBe(200);

    const submissions = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
      headers: { Cookie: ownerCookie },
    });
    expect(submissions.status).toBe(200);
  });

  it('admin has full access, including form creation', async () => {
    const ownerCookie = await authedCookie('forms-rbac-owner2@example.test');
    const adminCookie = await authedCookie('forms-rbac-admin@example.test');
    await setRole(ownerCookie, await userId(adminCookie), 'admin');

    const response = await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin form', slug: 'admin-form' }),
    });
    expect(response.status).toBe(201);
  });

  it('editor can read forms/submissions and triage a submission, but cannot create a form', async () => {
    const ownerCookie = await authedCookie('forms-rbac-owner3@example.test');
    const editorCookie = await authedCookie('forms-rbac-editor@example.test');
    // editor is the schema default — no setRole call needed.
    const form = await createForm(ownerCookie);

    const list = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
      headers: { Cookie: editorCookie },
    });
    expect(list.status).toBe(200);

    const createAttempt = await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Editor form', slug: 'editor-form' }),
    });
    expect(createAttempt.status).toBe(403);
  });

  it('author has NO Forms/Submissions access at all — not even read', async () => {
    const ownerCookie = await authedCookie('forms-rbac-owner4@example.test');
    const authorCookie = await authedCookie('forms-rbac-author@example.test');
    await setRole(ownerCookie, await userId(authorCookie), 'author');
    const form = await createForm(ownerCookie);

    const listForms = await SELF.fetch('https://example.com/api/v1/admin/forms', { headers: { Cookie: authorCookie } });
    expect(listForms.status).toBe(403);

    const getForm = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, { headers: { Cookie: authorCookie } });
    expect(getForm.status).toBe(403);

    const listSubmissions = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
      headers: { Cookie: authorCookie },
    });
    expect(listSubmissions.status).toBe(403);

    const unified = await SELF.fetch('https://example.com/api/v1/admin/submissions', { headers: { Cookie: authorCookie } });
    expect(unified.status).toBe(403);
  });

  it('viewer has read-only access — can list forms/submissions, cannot create a form', async () => {
    const ownerCookie = await authedCookie('forms-rbac-owner5@example.test');
    const viewerCookie = await authedCookie('forms-rbac-viewer@example.test');
    await setRole(ownerCookie, await userId(viewerCookie), 'viewer');
    const form = await createForm(ownerCookie);

    const listForms = await SELF.fetch('https://example.com/api/v1/admin/forms', { headers: { Cookie: viewerCookie } });
    expect(listForms.status).toBe(200);

    const listSubmissions = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
      headers: { Cookie: viewerCookie },
    });
    expect(listSubmissions.status).toBe(200);

    const unified = await SELF.fetch('https://example.com/api/v1/admin/submissions', { headers: { Cookie: viewerCookie } });
    expect(unified.status).toBe(200);

    const createAttempt = await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Viewer form', slug: 'viewer-form' }),
    });
    // blockViewerMutations (global) rejects this before requireFormsAccess ever needs to.
    expect(createAttempt.status).toBe(403);
  });

  it('the unified /api/v1/admin/submissions endpoint also enforces the author-excluded rule', async () => {
    const ownerCookie = await authedCookie('forms-rbac-owner6@example.test');
    const authorCookie = await authedCookie('forms-rbac-author2@example.test');
    await setRole(ownerCookie, await userId(authorCookie), 'author');

    const response = await SELF.fetch('https://example.com/api/v1/admin/submissions', { headers: { Cookie: authorCookie } });
    expect(response.status).toBe(403);
  });
});
