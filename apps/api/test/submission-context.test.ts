import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { isEntryOpen } from '../src/lib/submission-context';
import { registerWebsiteUser, signUpVerifiedAndGetCookie } from './helpers/auth';

const BASE = 'https://example.com';
const ORIGIN = 'http://localhost:5173';

let ipCounter = 0;
const nextIp = () => `submission-context-${++ipCounter}`;

async function adminJson(cookie: string, path: string, method: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

async function createOpportunityType(cookie: string) {
  const res = await adminJson(cookie, '/api/v1/admin/content-types', 'POST', { name: 'Opportunity', slug: 'opportunity' });
  expect(res.status).toBe(201);
  const type = await res.json<{ id: string }>();
  for (const field of [
    { name: 'title', label: 'Title', fieldType: 'text', required: true },
    { name: 'status', label: 'Status', fieldType: 'text', required: false },
    { name: 'applicationEnabled', label: 'Applications open', fieldType: 'boolean', required: false },
    { name: 'closingDate', label: 'Closing date', fieldType: 'date', required: false },
  ]) {
    expect((await adminJson(cookie, `/api/v1/admin/content-types/${type.id}/fields`, 'POST', field)).status).toBe(201);
  }
  return type;
}

async function createOpportunity(
  cookie: string,
  contentTypeId: string,
  slug: string,
  data: Record<string, unknown>,
  status: 'draft' | 'published' = 'published',
) {
  const res = await adminJson(cookie, `/api/v1/admin/entries?contentTypeId=${contentTypeId}`, 'POST', { slug, status, data });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>();
}

async function createApplicationForm(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await adminJson(cookie, '/api/v1/admin/forms', 'POST', {
    name: 'Job application',
    slug: 'job-application',
    requiresAccount: true,
    stages: ['Application received', 'Under review', 'Decision'],
    accountSubmissionUrl: 'https://site.example/careers/applications/{id}',
    notificationEmails: ['recruiting@example.test'],
    contextConfig: {
      contentType: 'opportunity',
      openWhen: [
        { field: 'status', equals: 'Open' },
        { field: 'applicationEnabled', equals: true },
      ],
      deadlineField: 'closingDate',
    },
    ...overrides,
  });
  expect(res.status).toBe(201);
  const form = await res.json<{ id: string; slug: string }>();
  await adminJson(cookie, `/api/v1/admin/forms/${form.id}/fields`, 'POST', {
    name: 'experience',
    label: 'Experience',
    fieldType: 'textarea',
    required: true,
  });
  return form;
}

function submit(slug: string, cookie: string | undefined, context: string | null, body: Record<string, string> = {}) {
  const form = new FormData();
  form.set('experience', 'Five years of social media work.');
  for (const [key, value] of Object.entries(body)) form.set(key, value);
  const headers: Record<string, string> = { 'CF-Connecting-IP': nextIp(), Origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  const query = context === null ? '' : `?context=${encodeURIComponent(context)}`;
  return SELF.fetch(`${BASE}/api/v1/public/forms/${slug}/submissions${query}`, { method: 'POST', headers, body: form });
}

describe('submission context (real D1)', () => {
  let ownerCookie: string;
  let typeId: string;

  beforeEach(async () => {
    for (const table of [
      'form_submission_stage_changes',
      'form_submission_replies',
      'form_submissions',
      'form_fields',
      'forms',
      'entries',
      'field_definitions',
      'content_types',
      'media_attachments',
      'media',
      'audit_log',
      'session',
      'account',
      'user',
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    clearTestEmails();
    ownerCookie = await signUpVerifiedAndGetCookie('owner@example.test');
    clearTestEmails();
    typeId = (await createOpportunityType(ownerCookie)).id;
  });

  it('stores the server-resolved entry with the submission and shows it to staff and to the owner', async () => {
    await createApplicationForm(ownerCookie);
    const entry = await createOpportunity(ownerCookie, typeId, 'marketing-specialist', {
      title: 'Marketing Specialist',
      status: 'Open',
      applicationEnabled: true,
    });
    const { cookie } = await registerWebsiteUser('ada@example.test');

    const res = await submit('job-application', cookie, 'marketing-specialist');
    expect(res.status).toBe(201);
    const created = await res.json<{ id: string; context: { slug: string; title: string; entryId: string | null } }>();
    expect(created.context).toEqual({
      contentType: 'opportunity',
      slug: 'marketing-specialist',
      title: 'Marketing Specialist',
      entryId: entry.id,
    });

    const mine = await SELF.fetch(`${BASE}/api/v1/account/forms/submissions/${created.id}`, {
      headers: { cookie, Origin: ORIGIN },
    });
    expect((await mine.json<{ context: { title: string } }>()).context.title).toBe('Marketing Specialist');

    const staff = await adminJson(ownerCookie, '/api/v1/admin/submissions', 'GET');
    const rows = await staff.json<{ id: string; context: { title: string } | null }[]>();
    expect(rows.find((row) => row.id === created.id)?.context?.title).toBe('Marketing Specialist');

    const notice = getTestEmails().find((mail) => mail.to === 'recruiting@example.test');
    expect(notice?.subject).toContain('Marketing Specialist');
  });

  it('ignores any context a visitor tries to put in the body: only the resolved entry is stored', async () => {
    await createApplicationForm(ownerCookie);
    await createOpportunity(ownerCookie, typeId, 'real-role', { title: 'Real role', status: 'Open', applicationEnabled: true });
    const { cookie } = await registerWebsiteUser('ada@example.test');

    const res = await submit('job-application', cookie, 'real-role', {
      context: 'other-role',
      contextEntryId: 'forged-id',
      accountUserId: 'someone-else',
    });
    expect(res.status).toBe(201);
    const created = await res.json<{ context: { slug: string; entryId: string }; accountUserId: string }>();
    expect(created.context.slug).toBe('real-role');
    expect(created.context.entryId).not.toBe('forged-id');
    expect(created.accountUserId).not.toBe('someone-else');
  });

  it('requires the context, and refuses unknown and unpublished entries like a missing one', async () => {
    await createApplicationForm(ownerCookie);
    await createOpportunity(ownerCookie, typeId, 'draft-role', { title: 'Draft', status: 'Open', applicationEnabled: true }, 'draft');
    const { cookie } = await registerWebsiteUser('ada@example.test');

    expect((await submit('job-application', cookie, null)).status).toBe(400);
    expect((await submit('job-application', cookie, 'does-not-exist')).status).toBe(404);
    expect((await submit('job-application', cookie, 'draft-role')).status).toBe(404);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_submissions').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('refuses a closed or disabled entry, and one past its deadline, but takes an open-ended one', async () => {
    await createApplicationForm(ownerCookie);
    await createOpportunity(ownerCookie, typeId, 'closed-role', { title: 'Closed', status: 'Closed', applicationEnabled: true });
    await createOpportunity(ownerCookie, typeId, 'paused-role', { title: 'Paused', status: 'Open', applicationEnabled: false });
    await createOpportunity(ownerCookie, typeId, 'late-role', {
      title: 'Late',
      status: 'Open',
      applicationEnabled: true,
      closingDate: '2020-01-01',
    });
    await createOpportunity(ownerCookie, typeId, 'open-ended', { title: 'Open ended', status: 'Open', applicationEnabled: true });
    const { cookie } = await registerWebsiteUser('ada@example.test');

    for (const slug of ['closed-role', 'paused-role', 'late-role']) {
      expect((await submit('job-application', cookie, slug)).status).toBe(409);
    }
    expect((await submit('job-application', cookie, 'open-ended')).status).toBe(201);
  });

  it('still needs a verified signed-in account, and nothing is stored for an anonymous attempt', async () => {
    await createApplicationForm(ownerCookie);
    await createOpportunity(ownerCookie, typeId, 'role', { title: 'Role', status: 'Open', applicationEnabled: true });

    expect((await submit('job-application', undefined, 'role')).status).toBe(401);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_submissions').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('keeps the snapshot after the entry is renamed or deleted, and a second account cannot see it', async () => {
    await createApplicationForm(ownerCookie);
    const entry = await createOpportunity(ownerCookie, typeId, 'role', { title: 'Role', status: 'Open', applicationEnabled: true });
    const ada = await registerWebsiteUser('ada@example.test');
    const eve = await registerWebsiteUser('eve@example.test');
    const created = await (await submit('job-application', ada.cookie, 'role')).json<{ id: string }>();

    expect((await adminJson(ownerCookie, `/api/v1/admin/entries/${entry.id}`, 'DELETE')).status).toBeLessThan(300);
    const afterDelete = await SELF.fetch(`${BASE}/api/v1/account/forms/submissions/${created.id}`, {
      headers: { cookie: ada.cookie, Origin: ORIGIN },
    });
    const detail = await afterDelete.json<{ context: { title: string; entryId: string | null } }>();
    expect(detail.context.title).toBe('Role');
    expect(detail.context.entryId).toBeNull();

    const other = await SELF.fetch(`${BASE}/api/v1/account/forms/submissions/${created.id}`, {
      headers: { cookie: eve.cookie, Origin: ORIGIN },
    });
    expect(other.status).toBe(404);
  });

  it('offers the context title to the stage-update email template', async () => {
    const form = await createApplicationForm(ownerCookie);
    await createOpportunity(ownerCookie, typeId, 'role', { title: 'Role', status: 'Open', applicationEnabled: true });
    const { cookie } = await registerWebsiteUser('ada@example.test');
    const created = await (await submit('job-application', cookie, 'role')).json<{ id: string }>();
    await adminJson(ownerCookie, '/api/v1/admin/email-templates', 'GET'); // seeds the defaults
    const tpl = await adminJson(ownerCookie, '/api/v1/admin/email-templates/form_submission_update', 'PATCH', {
      subject: 'Update on {{context.title}}',
    });
    expect(tpl.status).toBe(200);
    clearTestEmails();

    const res = await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage`, 'PUT', {
      stage: 'Under review',
    });
    expect(res.status).toBe(200);
    expect(getTestEmails().find((mail) => mail.to === 'ada@example.test')?.subject).toBe('Update on Role');
  });

  it('rejects a form whose context content type does not exist', async () => {
    const res = await adminJson(ownerCookie, '/api/v1/admin/forms', 'POST', {
      name: 'Bad',
      slug: 'bad',
      contextConfig: { contentType: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('leaves forms without a context untouched', async () => {
    await createApplicationForm(ownerCookie, { slug: 'plain', contextConfig: null });
    const { cookie } = await registerWebsiteUser('ada@example.test');
    const res = await submit('plain', cookie, null);
    expect(res.status).toBe(201);
    expect((await res.json<{ context: unknown }>()).context).toBeNull();
  });
});

describe('isEntryOpen', () => {
  const config = { contentType: 'opportunity', openWhen: [{ field: 'status', equals: 'Open' }], deadlineField: 'closingDate' };

  it('fails closed when a gated field is missing', () => {
    expect(isEntryOpen(config, {})).toBe(false);
  });

  it('keeps a bare closing date open for the whole day', () => {
    const data = { status: 'Open', closingDate: '2026-10-01' };
    expect(isEntryOpen(config, data, new Date('2026-10-01T20:00:00Z'))).toBe(true);
    expect(isEntryOpen(config, data, new Date('2026-10-02T00:00:01Z'))).toBe(false);
  });

  it('treats an unset or unparseable deadline as open-ended', () => {
    expect(isEntryOpen(config, { status: 'Open' })).toBe(true);
    expect(isEntryOpen(config, { status: 'Open', closingDate: 'soon' })).toBe(true);
  });
});
