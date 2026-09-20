import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails, isEmailProviderConfigured } from '../src/lib/email';
import type { Bindings } from '../src/lib/env';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
    headers: { Cookie: cookie },
  });
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

async function createContactForm(cookie: string) {
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  const form = await (
    await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Contact', slug: 'contact' }),
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
  await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'message', label: 'Message', fieldType: 'textarea', required: false }),
  });

  return form;
}

describe('forms routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM form_submissions');
    await env.DB.exec('DELETE FROM form_fields');
    await env.DB.exec('DELETE FROM forms');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
    clearTestEmails();
  });

  it('rejects admin form creation from an editor, allows it from an owner', async () => {
    const ownerCookie = await authedCookie('forms-owner@example.test');
    const editorCookie = await authedCookie('forms-editor@example.test');

    const editorRes = await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Contact', slug: 'contact' }),
    });
    expect(editorRes.status).toBe(403);

    const ownerRes = await SELF.fetch('https://example.com/api/v1/admin/forms', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Contact', slug: 'contact' }),
    });
    expect(ownerRes.status).toBe(201);
  });

  it('walks the admin flow: create form -> add fields -> list fields', async () => {
    const cookie = await authedCookie('forms-admin@example.test');
    const form = await createContactForm(cookie);

    const fieldsRes = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
      headers: { Cookie: cookie },
    });
    const fields = await fieldsRes.json<{ name: string; required: boolean }[]>();
    expect(fields).toHaveLength(3);
    expect(fields.map((f) => f.name)).toEqual(['name', 'email', 'message']);
  });

  it('accepts a valid public submission, sanitizes HTML, and stores it', async () => {
    const cookie = await authedCookie('forms-submit-admin@example.test');
    const form = await createContactForm(cookie);

    const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'submit-test-1' },
      body: JSON.stringify({
        name: 'Jane <script>alert(1)</script>Doe',
        email: 'jane@example.com',
        message: 'Hello there',
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ data: Record<string, unknown> }>();
    // No angle bracket survives sanitization, so no markup can ever be reconstructed from
    // the stored value — the surrounding legitimate text is preserved either side of it.
    expect(body.data['name']).not.toMatch(/[<>]/);
    expect(body.data['name']).toContain('Jane');
    expect(body.data['name']).toContain('Doe');
    expect(body.data['email']).toBe('jane@example.com');

    const submissionsRes = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/submissions`,
      { headers: { Cookie: cookie } },
    );
    const submissions = await submissionsRes.json<{ data: Record<string, unknown> }[]>();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.data['name']).not.toMatch(/[<>]/);
  });

  it('404s submitting to a form slug that does not exist', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/v1/public/forms/does-not-exist/submissions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'submit-test-2' },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(404);
  });

  it('rejects a submission missing a required field', async () => {
    const cookie = await authedCookie('forms-missing-admin@example.test');
    await createContactForm(cookie);

    const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'submit-test-3' },
      body: JSON.stringify({ name: 'Jane Doe' }), // missing required email
    });
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe('Validation failed');
  });

  it('rejects a submission with an invalid email format', async () => {
    const cookie = await authedCookie('forms-bademail-admin@example.test');
    await createContactForm(cookie);

    const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'submit-test-4' },
      body: JSON.stringify({ name: 'Jane', email: 'not-an-email' }),
    });
    expect(response.status).toBe(400);
  });

  it('drops unknown fields from the submission rather than storing them', async () => {
    const cookie = await authedCookie('forms-extra-admin@example.test');
    await createContactForm(cookie);

    const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'submit-test-5' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', unexpectedField: 'nope' }),
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ data: Record<string, unknown> }>();
    expect(body.data).not.toHaveProperty('unexpectedField');
  });

  it('updates a submission\'s status', async () => {
    const cookie = await authedCookie('forms-status-admin@example.test');
    const form = await createContactForm(cookie);

    await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'status-test-1' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });
    const [submission] = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string; status: string }[]>();
    expect(submission?.status).toBe('new');

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission!.id}`,
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'read' });
  });

  it('404s updating a submission that does not belong to the given form', async () => {
    const cookie = await authedCookie('forms-status-mismatch-admin@example.test');
    const formA = await createContactForm(cookie);
    const formB = await (
      await SELF.fetch('https://example.com/api/v1/admin/forms', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Other', slug: 'other' }),
      })
    ).json<{ id: string }>();

    await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'status-test-2' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });
    const [submission] = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${formA.id}/submissions`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string }[]>();

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${formB.id}/submissions/${submission!.id}`,
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      },
    );
    expect(response.status).toBe(404);
  });

  it('deletes a submission, removing it from the list', async () => {
    const cookie = await authedCookie('forms-delete-admin@example.test');
    const form = await createContactForm(cookie);

    await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'delete-test-1' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });
    const [submission] = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string }[]>();

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission!.id}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(204);

    const remaining = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string }[]>();
    expect(remaining).toHaveLength(0);
  });

  it('404s deleting a submission that does not belong to the given form', async () => {
    const cookie = await authedCookie('forms-delete-mismatch-admin@example.test');
    const formA = await createContactForm(cookie);
    const formB = await (
      await SELF.fetch('https://example.com/api/v1/admin/forms', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Other', slug: 'other-delete' }),
      })
    ).json<{ id: string }>();

    await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'delete-test-2' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });
    const [submission] = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${formA.id}/submissions`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string }[]>();

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${formB.id}/submissions/${submission!.id}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(404);
  });

  it('rejects a viewer deleting a submission', async () => {
    const ownerCookie = await authedCookie('forms-delete-viewer-owner@example.test');
    const form = await createContactForm(ownerCookie);
    const viewerCookie = await authedCookie('forms-delete-viewer@example.test');
    await setRole(ownerCookie, await userId(viewerCookie), 'viewer');

    await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'delete-test-3' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });
    const [submission] = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/submissions`, {
        headers: { Cookie: ownerCookie },
      })
    ).json<{ id: string }[]>();

    const response = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission!.id}`,
      { method: 'DELETE', headers: { Cookie: viewerCookie } },
    );
    expect(response.status).toBe(403);
  });

  it('lists every submission across every form, joined with its form name/slug', async () => {
    const cookie = await authedCookie('forms-all-submissions-admin@example.test');
    const contact = await createContactForm(cookie);
    const newsletter = await (
      await SELF.fetch('https://example.com/api/v1/admin/forms', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Newsletter', slug: 'newsletter' }),
      })
    ).json<{ id: string }>();
    await SELF.fetch(`https://example.com/api/v1/admin/forms/${newsletter.id}/fields`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'email', label: 'Email', fieldType: 'email', required: true }),
    });

    await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'all-submissions-test-1' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });
    await SELF.fetch('https://example.com/api/v1/public/forms/newsletter/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'all-submissions-test-2' },
      body: JSON.stringify({ email: 'reader@example.com' }),
    });

    const response = await SELF.fetch('https://example.com/api/v1/admin/submissions', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const submissions = await response.json<{ formId: string; formName: string; formSlug: string }[]>();
    expect(submissions).toHaveLength(2);
    expect(submissions.map((s) => s.formName).sort()).toEqual(['Contact', 'Newsletter']);
    expect(submissions.find((s) => s.formId === contact.id)?.formSlug).toBe('contact');
  });

  it('rate limits repeat submissions from the same client', async () => {
    const cookie = await authedCookie('forms-ratelimit-admin@example.test');
    await createContactForm(cookie);

    const submit = () =>
      SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'rate-limit-test' },
        body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
      });

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await submit());
    }
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });

  it('updates and deletes a field definition, and renames a form', async () => {
    const cookie = await authedCookie('forms-field-edit@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const form = await createContactForm(cookie);

    const fields = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
        headers: { Cookie: cookie },
      })
    ).json<{ id: string; name: string }[]>();
    const messageField = fields.find((f) => f.name === 'message')!;

    const updateRes = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/fields/${messageField.id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ required: true }) },
    );
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ name: 'message', required: true });

    // A label-only PATCH must never touch `required` — a real, previously-undiscovered bug
    // (docs/SITE_BUILDER.md §24's follow-up pass) had `updateFormFieldSchema` silently default
    // an omitted `required` to `false`, silently un-requiring a field on any partial update
    // that didn't explicitly resend it.
    const labelOnlyRes = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/fields/${messageField.id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ label: 'Your message' }) },
    );
    expect(labelOnlyRes.status).toBe(200);
    expect(await labelOnlyRes.json()).toMatchObject({ label: 'Your message', required: true });

    const deleteRes = await SELF.fetch(
      `https://example.com/api/v1/admin/forms/${form.id}/fields/${messageField.id}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
    );
    expect(deleteRes.status).toBe(204);

    const fieldsAfterDelete = await (
      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
        headers: { Cookie: cookie },
      })
    ).json<{ name: string }[]>();
    expect(fieldsAfterDelete.map((f) => f.name).sort()).toEqual(['email', 'name']);

    const renameRes = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Contact Us' }),
    });
    expect(renameRes.status).toBe(200);
    expect(await renameRes.json()).toMatchObject({ name: 'Contact Us', slug: 'contact' });
  });

  it('rejects renaming a form from an editor', async () => {
    const ownerCookie = await authedCookie('forms-rename-owner@example.test');
    const editorCookie = await authedCookie('forms-rename-editor@example.test');
    const form = await createContactForm(ownerCookie);

    const response = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, {
      method: 'PATCH',
      headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(response.status).toBe(403);
  });

  describe('submission notification emails', () => {
    // authedCookie() itself sends a real (test-captured) email — better-auth's own
    // verification link, required for every signup (see auth.test.ts) — into the exact same
    // getTestEmails() store this suite reads from. Filtering to just the notification-shaped
    // subject keeps these assertions about the feature under test, not about signup's own,
    // unrelated email traffic.
    function submissionNotificationEmails() {
      return getTestEmails().filter((message) => message.subject.startsWith('New submission:'));
    }

    it('does not send any email when a form has no notificationEmails configured', async () => {
      const cookie = await authedCookie('notify-none-admin@example.test');
      await createContactForm(cookie);

      const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'notify-test-1' },
        body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
      });
      expect(response.status).toBe(201);
      expect(submissionNotificationEmails()).toHaveLength(0);
    });

    it('emails every configured recipient, with the field labels and values, when a submission is made', async () => {
      const cookie = await authedCookie('notify-configured-admin@example.test');
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
      const form = await createContactForm(cookie);

      const updateRes = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ notificationEmails: ['hr@example.test', 'ops@example.test'] }),
      });
      expect(updateRes.status).toBe(200);
      expect(await updateRes.json()).toMatchObject({ notificationEmails: ['hr@example.test', 'ops@example.test'] });

      const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'notify-test-2' },
        body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', message: 'Hello there' }),
      });
      expect(response.status).toBe(201);

      const sent = submissionNotificationEmails();
      expect(sent).toHaveLength(2);
      expect(sent.map((m) => m.to).sort()).toEqual(['hr@example.test', 'ops@example.test']);
      expect(sent[0]!.subject).toBe('New submission: Contact');
      expect(sent[0]!.text).toContain('Name: Jane');
      expect(sent[0]!.text).toContain('Email: jane@example.com');
      expect(sent[0]!.text).toContain('Message: Hello there');
    });

    it('rejects an invalid email address in notificationEmails', async () => {
      const cookie = await authedCookie('notify-invalid-admin@example.test');
      const form = await createContactForm(cookie);

      const response = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationEmails: ['not-an-email'] }),
      });
      expect(response.status).toBe(400);
    });

    it('clears notificationEmails when set back to null', async () => {
      const cookie = await authedCookie('notify-clear-admin@example.test');
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
      const form = await createContactForm(cookie);

      await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ notificationEmails: ['hr@example.test'] }),
      });
      const clearRes = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ notificationEmails: null }),
      });
      expect(clearRes.status).toBe(200);
      expect(await clearRes.json()).toMatchObject({ notificationEmails: null });
    });
  });

  describe('submission replies', () => {
    async function createSubmission(cookie: string) {
      const form = await createContactForm(cookie);
      const submitRes = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'reply-test-setup' },
        body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', message: 'Hello there' }),
      });
      const submission = await submitRes.json<{ id: string }>();
      return { form, submission };
    }

    it('sends a reply, records it, and lists it back in the thread', async () => {
      const cookie = await authedCookie('reply-admin@example.test');
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
      const { form, submission } = await createSubmission(cookie);

      const sendRes = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to: 'jane@example.com',
            subject: 'Re: Contact',
            bodyHtml: '<p>Thanks for reaching out!</p>',
          }),
        },
      );
      expect(sendRes.status).toBe(201);
      const created = await sendRes.json<{ id: string; to: string; subject: string; bodyHtml: string }>();
      expect(created.to).toBe('jane@example.com');
      expect(created.subject).toBe('Re: Contact');

      const sent = getTestEmails().filter((m) => m.subject === 'Re: Contact');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('jane@example.com');
      expect(sent[0]!.html).toBe('<p>Thanks for reaching out!</p>');
      expect(sent[0]!.text).toContain('Thanks for reaching out!');
      expect(sent[0]!.replyTo).toBe('reply-admin@example.test');

      const listRes = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
        { headers: { Cookie: cookie } },
      );
      expect(listRes.status).toBe(200);
      const replies = await listRes.json<{ id: string; subject: string }[]>();
      expect(replies).toHaveLength(1);
      expect(replies[0]!.id).toBe(created.id);
    });

    it('defaults Reply-To to the configured sender address, and lets a reply override it', async () => {
      const cookie = await authedCookie('reply-default-admin@example.test');
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
      const { form, submission } = await createSubmission(cookie);

      // With a sender address configured it becomes the default; a per-reply override beats it.
      await SELF.fetch('https://example.com/api/v1/admin/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: 'Site', emailSenderEmail: 'hello@acme.test' }),
      });
      const replyUrl = `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`;
      const post = (extra: object, subject: string) =>
        SELF.fetch(replyUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ to: 'jane@example.com', subject, bodyHtml: '<p>x</p>', ...extra }),
        });
      expect((await post({}, 'Re: default')).status).toBe(201);
      expect((await post({ replyTo: 'other@example.com' }, 'Re: override')).status).toBe(201);
      expect(getTestEmails().find((m) => m.subject === 'Re: default')!.replyTo).toBe('hello@acme.test');
      expect(getTestEmails().find((m) => m.subject === 'Re: override')!.replyTo).toBe('other@example.com');
    });

    it('rejects a viewer sending a reply', async () => {
      const ownerCookie = await authedCookie('reply-viewer-owner@example.test');
      const { form, submission } = await createSubmission(ownerCookie);
      const viewerCookie = await authedCookie('reply-viewer@example.test');
      await setRole(ownerCookie, await userId(viewerCookie), 'viewer');

      const response = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
        {
          method: 'POST',
          headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'jane@example.com', subject: 'Re: Contact', bodyHtml: '<p>Hi</p>' }),
        },
      );
      expect(response.status).toBe(403);
    });

    it('sanitizes a stored-XSS reply body before sending or persisting it', async () => {
      const cookie = await authedCookie('reply-xss-admin@example.test');
      const { form, submission } = await createSubmission(cookie);

      const malicious =
        '<p>Hello <script>alert(1)</script><img src=x onerror="alert(2)">' +
        '<a href="javascript:alert(3)" onclick="alert(4)">click</a>' +
        '<a href="data:text/html,evil">data link</a>' +
        '<a href="vbscript:msgbox(5)">vbscript link</a>' +
        '<a href="https://example.com" target="_blank">safe link</a></p>';

      const sendRes = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
        {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'jane@example.com', subject: 'Re: XSS', bodyHtml: malicious }),
        },
      );
      expect(sendRes.status).toBe(201);
      const created = await sendRes.json<{ bodyHtml: string }>();

      // No script/img/event-handler survives at all.
      expect(created.bodyHtml).not.toContain('<script');
      expect(created.bodyHtml).not.toContain('<img');
      expect(created.bodyHtml).not.toContain('onerror');
      expect(created.bodyHtml).not.toContain('onclick');
      // The script tag itself is gone — its former text content survives only as inert,
      // non-executable text (not wrapped in any tag that could run it).
      expect(created.bodyHtml).not.toContain('<script');
      expect(created.bodyHtml).toContain('alert(1)');
      // Dangerous-protocol links are stripped of their href entirely, never merely re-quoted.
      expect(created.bodyHtml).not.toContain('javascript:');
      expect(created.bodyHtml).not.toContain('data:text/html');
      expect(created.bodyHtml).not.toContain('vbscript:');
      // A safe http(s) link with target="_blank" is preserved, with a forced safe rel.
      expect(created.bodyHtml).toContain('href="https://example.com"');
      expect(created.bodyHtml).toContain('rel="noopener noreferrer"');

      // The email actually sent used the same sanitized body, not the raw attacker input.
      const sent = getTestEmails().find((m) => m.subject === 'Re: XSS');
      expect(sent?.html).toBe(created.bodyHtml);
      expect(sent?.html).not.toContain('<script');

      // What's persisted (and later re-served through the list endpoint) is sanitized too.
      const listRes = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/replies`,
        { headers: { Cookie: cookie } },
      );
      const replies = await listRes.json<{ bodyHtml: string }[]>();
      expect(replies[0]!.bodyHtml).toBe(created.bodyHtml);
    });

    // The reply route 400s when isEmailProviderConfigured(c.env) is false, but a real
    // per-request env override isn't practical through SELF.fetch (it always runs against the
    // real wrangler.test.toml-bound env, where EMAIL_PROVIDER=test is always "configured" —
    // see the successful-send test above). Asserting the guard directly is the same approach
    // auth.test.ts already uses for createAuth's own guard.
    it('isEmailProviderConfigured requires the matching provider\'s full config, not just EMAIL_PROVIDER being set', () => {
      expect(isEmailProviderConfigured({} as Bindings)).toBe(false);
      expect(isEmailProviderConfigured({ EMAIL_PROVIDER: 'resend' } as Bindings)).toBe(false);
      expect(
        isEmailProviderConfigured({
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 'key',
          EMAIL_FROM: 'noreply@example.test',
        } as Bindings),
      ).toBe(true);
    });

    it('404s replying to a submission that does not belong to the given form', async () => {
      const cookie = await authedCookie('reply-mismatch-admin@example.test');
      const { submission } = await createSubmission(cookie);
      const otherForm = await (
        await SELF.fetch('https://example.com/api/v1/admin/forms', {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Other', slug: 'other-reply' }),
        })
      ).json<{ id: string }>();

      const response = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${otherForm.id}/submissions/${submission.id}/replies`,
        {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'jane@example.com', subject: 'Re: Contact', bodyHtml: '<p>Hi</p>' }),
        },
      );
      expect(response.status).toBe(404);
    });
  });

  describe('file-upload field (multipart submissions)', () => {
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

    it('accepts a real PDF resume via multipart/form-data and serves it back through the admin download route', async () => {
      const cookie = await authedCookie('job-app-admin@example.test');
      const form = await createJobApplicationForm(cookie);

      const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%fake but signature-valid PDF body');
      const body = new FormData();
      body.set('name', 'Jane Doe');
      body.set('resume', new File([pdfBytes], 'jane-doe-resume.pdf', { type: 'application/pdf' }));

      const submitRes = await SELF.fetch('https://example.com/api/v1/public/forms/job-application/submissions', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': 'file-upload-test-1' },
        body,
      });
      expect(submitRes.status).toBe(201);
      const submission = await submitRes.json<{ id: string; data: Record<string, unknown> }>();
      const resume = submission.data['resume'] as { key: string; filename: string; contentType: string; size: number };
      expect(resume.filename).toBe('jane-doe-resume.pdf');
      expect(resume.contentType).toBe('application/pdf');
      expect(resume.size).toBe(pdfBytes.byteLength);
      // The raw bytes never round-trip through D1 — only the R2 key/metadata does.
      expect(JSON.stringify(submission.data)).not.toContain('fake but signature-valid');

      const downloadRes = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/files/resume`,
        { headers: { Cookie: cookie } },
      );
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('Content-Type')).toBe('application/pdf');
      expect(new Uint8Array(await downloadRes.arrayBuffer())).toEqual(pdfBytes);
    });

    it('rejects a file whose actual bytes are not a recognized format, regardless of its declared type', async () => {
      const cookie = await authedCookie('job-app-badfile-admin@example.test');
      await createJobApplicationForm(cookie);

      const body = new FormData();
      body.set('name', 'Jane Doe');
      body.set(
        'resume',
        new File([new TextEncoder().encode('just plain text, not a real PDF')], 'resume.pdf', {
          type: 'application/pdf',
        }),
      );

      const response = await SELF.fetch('https://example.com/api/v1/public/forms/job-application/submissions', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': 'file-upload-test-2' },
        body,
      });
      expect(response.status).toBe(400);
    });

    it('rejects a submission missing the required file field', async () => {
      const cookie = await authedCookie('job-app-missing-admin@example.test');
      await createJobApplicationForm(cookie);

      const body = new FormData();
      body.set('name', 'Jane Doe');

      const response = await SELF.fetch('https://example.com/api/v1/public/forms/job-application/submissions', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': 'file-upload-test-3' },
        body,
      });
      expect(response.status).toBe(400);
    });

    it('404s downloading an attachment from a field with no file attached', async () => {
      const cookie = await authedCookie('job-app-nofile-admin@example.test');
      const form = await createJobApplicationForm(cookie);

      const body = new FormData();
      body.set('name', 'Jane Doe');
      body.set('resume', new File([new TextEncoder().encode('%PDF-1.4')], 'r.pdf', { type: 'application/pdf' }));
      const submission = await (
        await SELF.fetch('https://example.com/api/v1/public/forms/job-application/submissions', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': 'file-upload-test-4' },
          body,
        })
      ).json<{ id: string }>();

      const response = await SELF.fetch(
        `https://example.com/api/v1/admin/forms/${form.id}/submissions/${submission.id}/files/name`,
        { headers: { Cookie: cookie } },
      );
      expect(response.status).toBe(404);
    });
  });
});
