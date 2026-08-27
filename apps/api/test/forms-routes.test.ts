import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
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
  });

  it('rejects admin form creation from an editor, allows it from an owner', async () => {
    const ownerCookie = await authedCookie('forms-owner@pathvera.test');
    const editorCookie = await authedCookie('forms-editor@pathvera.test');

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
    const cookie = await authedCookie('forms-admin@pathvera.test');
    const form = await createContactForm(cookie);

    const fieldsRes = await SELF.fetch(`https://example.com/api/v1/admin/forms/${form.id}/fields`, {
      headers: { Cookie: cookie },
    });
    const fields = await fieldsRes.json<{ name: string; required: boolean }[]>();
    expect(fields).toHaveLength(3);
    expect(fields.map((f) => f.name)).toEqual(['name', 'email', 'message']);
  });

  it('accepts a valid public submission, sanitizes HTML, and stores it', async () => {
    const cookie = await authedCookie('forms-submit-admin@pathvera.test');
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
    const cookie = await authedCookie('forms-missing-admin@pathvera.test');
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
    const cookie = await authedCookie('forms-bademail-admin@pathvera.test');
    await createContactForm(cookie);

    const response = await SELF.fetch('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'submit-test-4' },
      body: JSON.stringify({ name: 'Jane', email: 'not-an-email' }),
    });
    expect(response.status).toBe(400);
  });

  it('drops unknown fields from the submission rather than storing them', async () => {
    const cookie = await authedCookie('forms-extra-admin@pathvera.test');
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
    const cookie = await authedCookie('forms-status-admin@pathvera.test');
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
    const cookie = await authedCookie('forms-status-mismatch-admin@pathvera.test');
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

  it('lists every submission across every form, joined with its form name/slug', async () => {
    const cookie = await authedCookie('forms-all-submissions-admin@pathvera.test');
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
    const cookie = await authedCookie('forms-ratelimit-admin@pathvera.test');
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
});
