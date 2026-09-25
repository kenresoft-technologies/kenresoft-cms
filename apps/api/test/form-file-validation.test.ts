import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFormField } from '../src/repositories/form-fields';
import { createForm } from '../src/repositories/forms';
import { buildZip } from './helpers/zip';

// A crafted request straight to the public submission endpoint, bypassing any browser-side
// checks (accept=".pdf,.docx", size hints). The CMS decides from the file's bytes, and a file
// field's config.accept narrows what it takes. Nothing rejected may be stored.

const db = createDb(env.DB);
const MB = 1024 * 1024;

const pdf = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  return bytes;
};
const docx = () => buildZip(['[Content_Types].xml', 'word/document.xml']);
const png = () =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
  ]);

let ip = 0;
async function submit(file: File | null) {
  const body = new FormData();
  body.set('name', 'Ada Student');
  if (file) body.set('document', file);
  return SELF.fetch('https://example.com/api/v1/public/forms/documents/submissions', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `file-validation-${++ip}` },
    body,
  });
}

async function storedCounts() {
  const submissions = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_submissions').first<{ n: number }>();
  const media = await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>();
  const objects = await env.MEDIA_BUCKET.list();
  return { submissions: submissions!.n, media: media!.n, objects: objects.objects.length };
}

describe('file validation at the public submission endpoint (real D1 + R2)', () => {
  beforeEach(async () => {
    for (const table of ['form_submission_stage_changes', 'form_submissions', 'form_fields', 'forms', 'media_attachments', 'media']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    const listed = await env.MEDIA_BUCKET.list();
    if (listed.objects.length) await env.MEDIA_BUCKET.delete(listed.objects.map((object) => object.key));

    const form = await createForm(db, { name: 'Documents', slug: 'documents' });
    await createFormField(db, { formId: form.id, name: 'name', label: 'Name', fieldType: 'text', required: true, sortOrder: 0, config: null });
    await createFormField(db, {
      formId: form.id,
      name: 'document',
      label: 'Document',
      fieldType: 'file',
      required: true,
      sortOrder: 1,
      config: { accept: ['pdf', 'docx'] },
    });
  });

  it('accepts a PDF and a DOCX', async () => {
    expect((await submit(new File([pdf()], 'cv.pdf'))).status).toBe(201);
    expect((await submit(new File([docx()], 'cv.docx'))).status).toBe(201);
    expect(await storedCounts()).toEqual({ submissions: 2, media: 2, objects: 2 });
  });

  it.each([
    ['a legacy .doc', () => new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])], 'cv.doc'), 'Unsupported'],
    ['a .pdf name on non-PDF content', () => new File([new TextEncoder().encode('<script>alert(1)</script>')], 'cv.pdf'), 'Unsupported'],
    ['a Windows executable', () => new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])], 'cv.exe'), 'Unsupported'],
    ['a macro-enabled Word file renamed .docx', () => new File([buildZip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'])], 'cv.docx'), 'Unsupported'],
    ['an image when the field accepts PDF or DOCX only', () => new File([png()], 'cv.png'), 'File must be PDF or DOCX'],
    ['an empty file', () => new File([], 'cv.pdf'), 'File is empty'],
    ['a file over 10 MB', () => new File([pdf(10 * MB + 1)], 'cv.pdf'), 'at most'],
  ])('rejects %s with a 400 and stores nothing', async (_label, makeFile, message) => {
    const res = await submit(makeFile());
    expect(res.status).toBe(400);
    const body = await res.json<{ issues: { path: string[]; message: string }[] }>();
    expect(body.issues).toEqual([expect.objectContaining({ path: ['document'], message: expect.stringContaining(message) })]);
    expect(await storedCounts()).toEqual({ submissions: 0, media: 0, objects: 0 });
  });

  it('rejects a missing required file', async () => {
    const res = await submit(null);
    expect(res.status).toBe(400);
    expect(await storedCounts()).toEqual({ submissions: 0, media: 0, objects: 0 });
  });
});
