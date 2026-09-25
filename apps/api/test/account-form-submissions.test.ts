import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { registerWebsiteUser, signUpVerifiedAndGetCookie } from './helpers/auth';

const BASE = 'https://example.com';
const ORIGIN = 'http://localhost:5173';
const STAGES = ['Submitted', 'Under Review', 'In Progress', 'Awaiting Student', 'Completed'];

const pdf = (size = 32) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return bytes;
};

let ipCounter = 0;
const nextIp = () => `account-forms-${++ipCounter}`;

async function adminJson(cookie: string, path: string, method: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

async function createAccountForm(ownerCookie: string, overrides: Record<string, unknown> = {}) {
  const res = await adminJson(ownerCookie, '/api/v1/admin/forms', 'POST', {
    name: 'Support request',
    slug: 'support',
    requiresAccount: true,
    stages: STAGES,
    accountSubmissionUrl: 'https://site.example/requests/{id}',
    notificationEmails: ['staff@example.test'],
    ...overrides,
  });
  expect(res.status).toBe(201);
  const form = await res.json<{ id: string; slug: string }>();
  for (const field of [
    { name: 'name', label: 'Name', fieldType: 'text', required: true },
    { name: 'email', label: 'Email', fieldType: 'email', required: true },
    { name: 'details', label: 'Details', fieldType: 'textarea', required: true },
    { name: 'document', label: 'Document', fieldType: 'file', required: false },
  ]) {
    await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/fields`, 'POST', field);
  }
  return form;
}

async function submit(slug: string, options: { cookie?: string; origin?: string | null; file?: boolean } = {}) {
  const body = new FormData();
  body.set('name', 'Ada Student');
  body.set('email', 'ada@example.test');
  body.set('details', 'Please review my CV.');
  if (options.file) body.set('document', new File([pdf()], 'cv.pdf'));
  const headers: Record<string, string> = { 'CF-Connecting-IP': nextIp() };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN;
  return SELF.fetch(`${BASE}/api/v1/public/forms/${slug}/submissions`, { method: 'POST', headers, body });
}

function account(cookie: string, path: string, init: RequestInit = {}) {
  return SELF.fetch(`${BASE}/api/v1/account/forms${path}`, {
    ...init,
    headers: { cookie, Origin: ORIGIN, ...(init.headers as Record<string, string> | undefined) },
  });
}

describe('account-linked form submissions (real D1)', () => {
  let ownerCookie: string;

  beforeEach(async () => {
    for (const table of [
      'form_submission_stage_changes',
      'form_submission_replies',
      'form_submissions',
      'form_fields',
      'forms',
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
  });

  it('leaves an anonymous form exactly as before: no session needed, no owner, no stage', async () => {
    const form = await createAccountForm(ownerCookie, { slug: 'contact', requiresAccount: false, stages: null });
    const res = await submit(form.slug, { origin: null });
    expect(res.status).toBe(201);
    const created = await res.json<{ accountUserId: string | null; stage: string | null }>();
    expect(created.accountUserId).toBeNull();
    expect(created.stage).toBeNull();
  });

  it('requires a signed-in account and a trusted origin to submit a requiresAccount form', async () => {
    const form = await createAccountForm(ownerCookie);
    const { cookie } = await registerWebsiteUser('ada@example.test');

    expect((await submit(form.slug)).status).toBe(401);
    expect((await submit(form.slug, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await submit(form.slug, { cookie, origin: null })).status).toBe(403);

    const unverified = await registerWebsiteUser('unverified@example.test', { verified: false });
    expect(unverified.cookie).toBe('');
    expect((await submit(form.slug, { cookie: 'better-auth.session_token=forged' })).status).toBe(401);
  });

  it('links the submission to the session account, starts it in the first stage, and records the history', async () => {
    const form = await createAccountForm(ownerCookie);
    const { customer, cookie } = await registerWebsiteUser('ada@example.test');

    const res = await submit(form.slug, { cookie, file: true });
    expect(res.status).toBe(201);
    const created = await res.json<{ id: string; accountUserId: string; stage: string }>();
    expect(created.accountUserId).toBe(customer.id);
    expect(created.stage).toBe('Submitted');

    const list = await (await account(cookie, '/submissions')).json<{ id: string; stage: string; stages: string[] }[]>();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, stage: 'Submitted', stages: STAGES });

    const detail = await (await account(cookie, `/submissions/${created.id}`)).json<{
      stageHistory: { stage: string }[];
      files: Record<string, { mediaId: string; filename: string }>;
      data: Record<string, unknown>;
    }>();
    expect(detail.stageHistory.map((change) => change.stage)).toEqual(['Submitted']);
    expect(detail.files['document']?.filename).toBe('cv.pdf');
    expect(detail).not.toHaveProperty('status');
    expect(detail).not.toHaveProperty('isTest');

    const download = await account(cookie, `/submissions/${created.id}/files/${detail.files['document']!.mediaId}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf());
  });

  it("never lets one account see, download from or message another account's submission", async () => {
    const form = await createAccountForm(ownerCookie);
    const ada = await registerWebsiteUser('ada@example.test');
    const bob = await registerWebsiteUser('bob@example.test');
    const adaSubmission = await (await submit(form.slug, { cookie: ada.cookie, file: true })).json<{ id: string }>();
    const bobSubmission = await (await submit(form.slug, { cookie: bob.cookie, file: true })).json<{ id: string }>();
    const adaDetail = await (await account(ada.cookie, `/submissions/${adaSubmission.id}`)).json<{
      files: Record<string, { mediaId: string }>;
    }>();
    const adaMediaId = adaDetail.files['document']!.mediaId;

    // Bob lists only his own.
    const bobList = await (await account(bob.cookie, '/submissions')).json<{ id: string }[]>();
    expect(bobList.map((s) => s.id)).toEqual([bobSubmission.id]);

    // Tampering with the submission id.
    expect((await account(bob.cookie, `/submissions/${adaSubmission.id}`)).status).toBe(404);
    expect((await account(bob.cookie, `/submissions/${adaSubmission.id}/files/${adaMediaId}`)).status).toBe(404);
    const message = new FormData();
    message.set('body', 'hello');
    expect((await account(bob.cookie, `/submissions/${adaSubmission.id}/messages`, { method: 'POST', body: message })).status).toBe(404);

    // Tampering with the file id: Ada's file through Bob's own submission.
    expect((await account(bob.cookie, `/submissions/${bobSubmission.id}/files/${adaMediaId}`)).status).toBe(404);
    // Nothing was written by the rejected message.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM form_submission_replies').first<{ n: number }>())?.n).toBe(0);

    // Guessed file ids: a made-up one, and a real Media Library item that isn't part of the thread.
    expect((await account(bob.cookie, `/submissions/${bobSubmission.id}/files/${crypto.randomUUID()}`)).status).toBe(404);
    const libraryUpload = new FormData();
    libraryUpload.set('file', new File([pdf()], 'internal.pdf'));
    libraryUpload.set('visibility', 'private');
    const library = await SELF.fetch(`${BASE}/api/v1/admin/media`, { method: 'POST', headers: { cookie: ownerCookie }, body: libraryUpload });
    expect(library.status).toBe(201);
    const libraryId = (await library.json<{ id: string }>()).id;
    expect((await account(bob.cookie, `/submissions/${bobSubmission.id}/files/${libraryId}`)).status).toBe(404);

    // No session at all.
    expect((await SELF.fetch(`${BASE}/api/v1/account/forms/submissions`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/api/v1/account/forms/submissions/${adaSubmission.id}/files/${adaMediaId}`)).status).toBe(401);
  });

  it('keeps website accounts out of the admin API', async () => {
    const form = await createAccountForm(ownerCookie);
    const { cookie } = await registerWebsiteUser('ada@example.test');
    const created = await (await submit(form.slug, { cookie })).json<{ id: string }>();

    expect((await adminJson(cookie, '/api/v1/admin/forms', 'GET')).status).toBe(403);
    expect((await adminJson(cookie, `/api/v1/admin/forms/${form.id}/submissions`, 'GET')).status).toBe(403);
    expect(
      (await adminJson(cookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage`, 'PUT', { stage: 'Completed' })).status,
    ).toBe(403);
    expect((await adminJson(cookie, '/api/v1/admin/users', 'GET')).status).toBe(403);
    expect((await adminJson(cookie, '/api/v1/admin/media', 'GET')).status).toBe(403);
    expect((await adminJson(cookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/replies`, 'GET')).status).toBe(403);
    expect((await adminJson(cookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}`, 'DELETE')).status).toBe(403);
  });

  it('lets staff move a submission through its stages, emailing the account, and shows the account on the admin list', async () => {
    const form = await createAccountForm(ownerCookie);
    const { cookie, customer } = await registerWebsiteUser('ada@example.test', { name: 'Ada Student' });
    const created = await (await submit(form.slug, { cookie })).json<{ id: string }>();
    clearTestEmails();

    const invalid = await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage`, 'PUT', {
      stage: 'Shipped',
    });
    expect(invalid.status).toBe(400);

    const moved = await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage`, 'PUT', {
      stage: 'In Progress',
    });
    expect(moved.status).toBe(200);
    expect((await moved.json<{ stage: string }>()).stage).toBe('In Progress');

    const update = getTestEmails().find((email) => email.to === 'ada@example.test');
    expect(update?.subject).toBe('Update on your Support request request');
    expect(update?.html).toContain(`https://site.example/requests/${created.id}`);
    expect(update?.html).toContain('In Progress');

    // notifyAccount: false stays quiet.
    clearTestEmails();
    await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage`, 'PUT', {
      stage: 'Awaiting Student',
      notifyAccount: false,
    });
    expect(getTestEmails()).toHaveLength(0);

    const detail = await (await account(cookie, `/submissions/${created.id}`)).json<{ stage: string; stageHistory: { stage: string }[] }>();
    expect(detail.stage).toBe('Awaiting Student');
    expect(detail.stageHistory.map((change) => change.stage)).toEqual(['Submitted', 'In Progress', 'Awaiting Student']);

    const history = await (
      await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage-history`, 'GET')
    ).json<{ stage: string }[]>();
    expect(history.map((change) => change.stage)).toEqual(['Submitted', 'In Progress', 'Awaiting Student']);

    const adminList = await (await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions`, 'GET')).json<
      { id: string; stage: string; account: { id: string; email: string } | null }[]
    >();
    expect(adminList[0]).toMatchObject({ id: created.id, stage: 'Awaiting Student', account: { id: customer.id, email: 'ada@example.test' } });
  });

  it('delivers a staff reply and its file to the account, and an account message and its file to staff', async () => {
    const form = await createAccountForm(ownerCookie);
    const { cookie } = await registerWebsiteUser('ada@example.test', { name: 'Ada Student' });
    const created = await (await submit(form.slug, { cookie })).json<{ id: string }>();
    clearTestEmails();

    // Staff reply with the completed document.
    const reply = new FormData();
    reply.set('to', 'ada@example.test');
    reply.set('subject', 'Your CV is ready');
    reply.set('bodyHtml', '<p>Here is your reviewed CV.</p><script>alert(1)</script>');
    reply.append('files', new File([pdf(48)], 'reviewed-cv.pdf'));
    const replyRes = await SELF.fetch(`${BASE}/api/v1/admin/forms/${form.id}/submissions/${created.id}/replies`, {
      method: 'POST',
      headers: { cookie: ownerCookie },
      body: reply,
    });
    expect(replyRes.status).toBe(201);
    const email = getTestEmails().find((sent) => sent.subject === 'Your CV is ready');
    expect(email?.html).toContain(`https://site.example/requests/${created.id}`);

    const detail = await (await account(cookie, `/submissions/${created.id}`)).json<{
      messages: { from: string; bodyHtml: string; attachments: { mediaId: string; filename: string }[] }[];
    }>();
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]!.from).toBe('staff');
    expect(detail.messages[0]!.bodyHtml).not.toContain('<script');
    expect(detail.messages[0]).not.toHaveProperty('to');
    const completed = detail.messages[0]!.attachments[0]!;
    expect(completed.filename).toBe('reviewed-cv.pdf');
    const download = await account(cookie, `/submissions/${created.id}/files/${completed.mediaId}`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf(48));

    // Another account can't fetch the completed file, even knowing its id.
    const bob = await registerWebsiteUser('bob@example.test');
    const bobSubmission = await (await submit(form.slug, { cookie: bob.cookie })).json<{ id: string }>();
    expect((await account(bob.cookie, `/submissions/${bobSubmission.id}/files/${completed.mediaId}`)).status).toBe(404);
    clearTestEmails();

    // The account replies with an extra document; HTML in the message is escaped.
    const message = new FormData();
    message.set('body', 'Thanks! Here is the <b>job description</b>.\n\nSecond paragraph.');
    message.append('files', new File([pdf(40)], 'job.pdf'));
    const messageRes = await account(cookie, `/submissions/${created.id}/messages`, { method: 'POST', body: message });
    expect(messageRes.status).toBe(201);
    const posted = await messageRes.json<{ from: string; bodyHtml: string; attachments: { mediaId: string }[] }>();
    expect(posted.from).toBe('account');
    expect(posted.bodyHtml).toBe('<p>Thanks! Here is the &lt;b&gt;job description&lt;/b&gt;.</p><p>Second paragraph.</p>');

    const staffEmail = getTestEmails().find((sent) => sent.to === 'staff@example.test');
    expect(staffEmail?.subject).toBe('New message: Support request');

    const adminReplies = await (
      await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/replies`, 'GET')
    ).json<{ direction: string; to: string | null; attachments: { mediaId: string }[] }[]>();
    expect(adminReplies.map((r) => r.direction)).toEqual(['outbound', 'inbound']);
    expect(adminReplies[1]!.to).toBeNull();
    const staffDownload = await SELF.fetch(
      `${BASE}/api/v1/admin/forms/${form.id}/submissions/${created.id}/attachments/${posted.attachments[0]!.mediaId}`,
      { headers: { cookie: ownerCookie } },
    );
    expect(staffDownload.status).toBe(200);
    expect(new Uint8Array(await staffDownload.arrayBuffer())).toEqual(pdf(40));
    // A mediaId from another submission's thread doesn't resolve through this one.
    const crossDownload = await SELF.fetch(
      `${BASE}/api/v1/admin/forms/${form.id}/submissions/${bobSubmission.id}/attachments/${posted.attachments[0]!.mediaId}`,
      { headers: { cookie: ownerCookie } },
    );
    expect(crossDownload.status).toBe(404);
  });

  it('rejects empty messages, unsupported files and messages without a trusted origin', async () => {
    const form = await createAccountForm(ownerCookie);
    const { cookie } = await registerWebsiteUser('ada@example.test');
    const created = await (await submit(form.slug, { cookie })).json<{ id: string }>();
    const path = `/submissions/${created.id}/messages`;

    const empty = new FormData();
    empty.set('body', '   ');
    expect((await account(cookie, path, { method: 'POST', body: empty })).status).toBe(400);

    const badFile = new FormData();
    badFile.set('body', 'see file');
    badFile.append('files', new File([new TextEncoder().encode('MZ not a document')], 'virus.exe'));
    expect((await account(cookie, path, { method: 'POST', body: badFile })).status).toBe(400);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM form_submission_replies').first<{ n: number }>())?.n).toBe(0);

    const noOrigin = new FormData();
    noOrigin.set('body', 'hi');
    const res = await SELF.fetch(`${BASE}/api/v1/account/forms${path}`, { method: 'POST', headers: { cookie }, body: noOrigin });
    expect(res.status).toBe(403);
  });

  it('removes stored message files when a submission is deleted', async () => {
    const form = await createAccountForm(ownerCookie);
    const { cookie } = await registerWebsiteUser('ada@example.test');
    const created = await (await submit(form.slug, { cookie, file: true })).json<{ id: string }>();
    const message = new FormData();
    message.set('body', 'extra file');
    message.append('files', new File([pdf()], 'extra.pdf'));
    await account(cookie, `/submissions/${created.id}/messages`, { method: 'POST', body: message });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>())?.n).toBe(2);

    const res = await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}`, 'DELETE');
    expect(res.status).toBe(204);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>())?.n).toBe(0);
    expect((await env.MEDIA_BUCKET.list()).objects).toHaveLength(0);
  });

  it('keeps a submission, its files and its thread workable for staff after its account is deleted', async () => {
    const form = await createAccountForm(ownerCookie);
    const { customer, cookie } = await registerWebsiteUser('ada@example.test');
    const created = await (await submit(form.slug, { cookie, file: true })).json<{ id: string }>();
    const message = new FormData();
    message.set('body', 'Here is my cover letter too.');
    message.append('files', new File([pdf()], 'letter.pdf'));
    expect((await account(cookie, `/submissions/${created.id}/messages`, { method: 'POST', body: message })).status).toBe(201);

    expect((await adminJson(ownerCookie, `/api/v1/admin/users/${customer.id}`, 'DELETE')).status).toBe(204);
    clearTestEmails();

    // The student is gone: their old session no longer works.
    expect((await account(cookie, '/submissions')).status).toBe(401);

    // Staff still see the submission, now without an owner, with its data and files intact.
    const list = await (await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions`, 'GET')).json<
      { id: string; accountUserId: string | null; account: unknown; stage: string; data: Record<string, unknown> }[]
    >();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, accountUserId: null, account: null, stage: 'Submitted' });
    expect(list[0]!.data['document']).toMatchObject({ filename: 'cv.pdf' });

    const submitted = await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/files/document`, 'GET');
    expect(submitted.status).toBe(200);
    await submitted.arrayBuffer();

    const replies = await (
      await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/replies`, 'GET')
    ).json<{ direction: string; authorName: string | null; attachments: { mediaId: string }[] }[]>();
    expect(replies).toEqual([expect.objectContaining({ direction: 'inbound', authorName: null })]);
    const threadFile = await adminJson(
      ownerCookie,
      `/api/v1/admin/forms/${form.id}/submissions/${created.id}/attachments/${replies[0]!.attachments[0]!.mediaId}`,
      'GET',
    );
    expect(threadFile.status).toBe(200);
    await threadFile.arrayBuffer();

    // Staff can keep moving it along. There is no account left to email.
    const stage = await adminJson(ownerCookie, `/api/v1/admin/forms/${form.id}/submissions/${created.id}/stage`, 'PUT', {
      stage: 'Under Review',
    });
    expect(stage.status).toBe(200);
    expect(getTestEmails()).toHaveLength(0);
  });

  it('validates stage lists and the account submission URL on the form', async () => {
    const duplicate = await adminJson(ownerCookie, '/api/v1/admin/forms', 'POST', {
      name: 'Dup',
      slug: 'dup',
      stages: ['Open', 'Open'],
    });
    expect(duplicate.status).toBe(400);
    const badUrl = await adminJson(ownerCookie, '/api/v1/admin/forms', 'POST', {
      name: 'Bad',
      slug: 'bad',
      accountSubmissionUrl: 'javascript:alert(1)',
    });
    expect(badUrl.status).toBe(400);
  });
});
