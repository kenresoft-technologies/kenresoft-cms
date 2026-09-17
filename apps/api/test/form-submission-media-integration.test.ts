import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Kept in its own file rather than folded into forms-routes.test.ts (already ~30 real-D1/R2
// tests) — this file's own standing note about Windows/workerd resource-exhaustion flakiness
// applies more the more R2 round trips a single file accumulates; this test alone does three
// (upload, download, delete) on top of everything else that file already does.
async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function createJobApplicationForm(cookie: string) {
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const form = await (
    await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Job Application', slug: 'job-application' }),
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
    body: JSON.stringify({ name: 'resume', label: 'Resume', fieldType: 'file', required: true }),
  });

  return form;
}

describe('form submission file uploads as Media attachments (Phase 5, real D1 + R2)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media_attachments');
    await env.DB.exec('DELETE FROM media');
    await env.DB.exec('DELETE FROM form_submissions');
    await env.DB.exec('DELETE FROM form_fields');
    await env.DB.exec('DELETE FROM forms');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('stores the attachment as a private Media asset, invisible in the default Media Library and cleaned up on submission delete', async () => {
    const cookie = await authedCookie('job-app-media-admin@example.test');
    const form = await createJobApplicationForm(cookie);

    const body = new FormData();
    body.set('name', 'Jane Doe');
    body.set(
      'resume',
      new File([new TextEncoder().encode('%PDF-1.4\nresume body')], 'resume.pdf', { type: 'application/pdf' }),
    );
    const submission = await (
      await SELF.fetch('https://example.com/api/v1/public/forms/job-application/submissions', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': 'file-upload-media-test' },
        body,
      })
    ).json<{ id: string; data: Record<string, unknown> }>();

    const resume = submission.data['resume'] as { mediaId: string; contentType: string; filename: string };
    expect(resume.mediaId).toBeTruthy();
    expect(resume.contentType).toBe('application/pdf');

    // Not shown in the admin Media Library's default grid — reachable only through the
    // submission's own detail view.
    const mediaList = await (
      await SELF.fetch('https://example.com/api/v1/admin/media', { headers: { Cookie: cookie } })
    ).json<{ id: string }[]>();
    expect(mediaList.find((item) => item.id === resume.mediaId)).toBeUndefined();

    // The download route still resolves the new {mediaId, ...} shape correctly. The body must
    // be consumed (not just the status checked) — an unread R2-backed response body leaves
    // vitest-pool-workers' isolated storage unable to release the R2 handle at test teardown
    // (the same gotcha public-media-routes.test.ts's own comment documents).
    const downloadRes = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/files/resume`,
      { headers: { Cookie: cookie } },
    );
    expect(downloadRes.status).toBe(200);
    await downloadRes.arrayBuffer();

    // Deleting the submission removes its only reference to the Media asset, and since nothing
    // else references it, the underlying Media/R2 object is deleted too.
    const deleteRes = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
    );
    expect(deleteRes.status).toBe(204);

    const mediaAfterDelete = await SELF.fetch(`https://example.com/api/v1/admin/media/${resume.mediaId}/file`, {
      headers: { Cookie: cookie },
    });
    expect(mediaAfterDelete.status).toBe(404);
  });
});
