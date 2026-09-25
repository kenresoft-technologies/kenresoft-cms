import { env } from 'cloudflare:test';
import { createDb, media, mediaAttachments } from '@kenresoft-cms/database';
import type { Database, Form, FormField } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { submitForm } from '../src/lib/submit-form';
import type { ParsedSubmissionBody } from '../src/lib/submit-form';
import { uploadMessageFiles } from '../src/lib/submission-thread';
import { createFormField } from '../src/repositories/form-fields';
import { createForm } from '../src/repositories/forms';

// The invariant under test: a successful submitForm() result means every submitted file exists
// as a private Media asset attached to the submission. When a file or the submission can't be
// stored, nothing is kept: no submission, no stage history, no Media rows, no R2 objects.
// Failures are injected by wrapping the real D1/R2 bindings, since vi.mock doesn't reliably
// intercept internal modules in this runtime (see media-import-external.test.ts).

const db = createDb(env.DB);
const STAGES = ['Submitted', 'In Progress', 'Completed'];

const pdf = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  return bytes;
};

function parsedWith(files: Record<string, File>): ParsedSubmissionBody {
  return { body: { name: 'Ada Student', details: 'Please review my CV.' }, uploadedFiles: new Map(Object.entries(files)) };
}

// R2 bucket whose put() throws from the nth call on.
function bucketFailingOnPut(failFromCall: number): R2Bucket {
  let calls = 0;
  return new Proxy(env.MEDIA_BUCKET, {
    get(target, prop) {
      if (prop === 'put') {
        return (...args: Parameters<R2Bucket['put']>) => {
          calls += 1;
          if (calls >= failFromCall) return Promise.reject(new Error('simulated R2 outage'));
          return target.put(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Database whose insert() into one table throws.
function dbFailingInsertsInto(table: unknown): Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'insert') {
        return (into: Parameters<Database['insert']>[0]) => {
          if (into === table) throw new Error('simulated D1 failure');
          return target.insert(into);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function storedState() {
  const [submissions, stageChanges, mediaRows, attachments, objects] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM form_submissions').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM form_submission_stage_changes').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM media_attachments').first<{ n: number }>(),
    env.MEDIA_BUCKET.list(),
  ]);
  return {
    submissions: submissions!.n,
    stageChanges: stageChanges!.n,
    media: mediaRows!.n,
    attachments: attachments!.n,
    objects: objects.objects.length,
  };
}

const EMPTY = { submissions: 0, stageChanges: 0, media: 0, attachments: 0, objects: 0 };

describe('submitForm file storage (real D1 + R2)', () => {
  let form: Form;
  let fields: FormField[];

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const table of [
      'form_submission_stage_changes',
      'form_submission_replies',
      'form_submissions',
      'form_fields',
      'forms',
      'media_attachments',
      'media',
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    const listed = await env.MEDIA_BUCKET.list();
    if (listed.objects.length) await env.MEDIA_BUCKET.delete(listed.objects.map((object) => object.key));

    form = await createForm(db, { name: 'Support', slug: 'support', stages: STAGES });
    fields = [
      await createFormField(db, { formId: form.id, name: 'name', label: 'Name', fieldType: 'text', required: true, sortOrder: 0, config: null }),
      await createFormField(db, { formId: form.id, name: 'details', label: 'Details', fieldType: 'textarea', required: true, sortOrder: 1, config: null }),
      await createFormField(db, { formId: form.id, name: 'document', label: 'Document', fieldType: 'file', required: false, sortOrder: 2, config: null }),
      await createFormField(db, { formId: form.id, name: 'extra', label: 'Extra', fieldType: 'file', required: false, sortOrder: 3, config: null }),
    ];
  });

  it('stores a submitted file as a private Media asset attached to the submission', async () => {
    const result = await submitForm(db, env.MEDIA_BUCKET, form, fields, parsedWith({ document: new File([pdf()], 'cv.pdf') }), {
      isTest: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const file = result.submission.data['document'] as { mediaId: string; filename: string; contentType: string };
    expect(file).toMatchObject({ filename: 'cv.pdf', contentType: 'application/pdf' });

    const row = await db.query.media.findFirst({ where: (table, { eq }) => eq(table.id, file.mediaId) });
    expect(row?.visibility).toBe('private');
    const object = await env.MEDIA_BUCKET.get(row!.key);
    expect(object).not.toBeNull();
    await object!.arrayBuffer();

    const links = await db.select().from(mediaAttachments);
    expect(links).toEqual([
      expect.objectContaining({ mediaId: file.mediaId, ownerType: 'form_submission', ownerId: result.submission.id, fieldName: 'document' }),
    ]);

    // The stored row matches what was returned, file reference included.
    const stored = await env.DB.prepare('SELECT data, stage FROM form_submissions WHERE id = ?')
      .bind(result.submission.id)
      .first<{ data: string; stage: string }>();
    expect(JSON.parse(stored!.data).document.mediaId).toBe(file.mediaId);
    expect(stored!.stage).toBe('Submitted');
    expect(await storedState()).toEqual({ submissions: 1, stageChanges: 1, media: 1, attachments: 1, objects: 1 });
  });

  it('stores a submission without a file when the file field is optional', async () => {
    const result = await submitForm(db, env.MEDIA_BUCKET, form, fields, parsedWith({}), { isTest: false });
    expect(result.ok).toBe(true);
    expect(await storedState()).toEqual({ ...EMPTY, submissions: 1, stageChanges: 1 });
  });

  it('keeps nothing and reports a 500 when the file upload fails', async () => {
    const result = await submitForm(
      db,
      bucketFailingOnPut(1),
      form,
      fields,
      parsedWith({ document: new File([pdf()], 'cv.pdf') }),
      { isTest: false },
    );
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(await storedState()).toEqual(EMPTY);
  });

  it('removes files already stored when a later file fails', async () => {
    const result = await submitForm(
      db,
      bucketFailingOnPut(2),
      form,
      fields,
      parsedWith({ document: new File([pdf()], 'cv.pdf'), extra: new File([pdf()], 'letter.pdf') }),
      { isTest: false },
    );
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(await storedState()).toEqual(EMPTY);
  });

  it('removes the R2 object when its Media row cannot be written', async () => {
    const result = await submitForm(
      dbFailingInsertsInto(media),
      env.MEDIA_BUCKET,
      form,
      fields,
      parsedWith({ document: new File([pdf()], 'cv.pdf') }),
      { isTest: false },
    );
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(await storedState()).toEqual(EMPTY);
  });

  it('rolls back the submission, its stage history and its files when attaching the file fails', async () => {
    const result = await submitForm(
      dbFailingInsertsInto(mediaAttachments),
      env.MEDIA_BUCKET,
      form,
      fields,
      parsedWith({ document: new File([pdf()], 'cv.pdf') }),
      { isTest: false },
    );
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(await storedState()).toEqual(EMPTY);
  });

  it('rejects an invalid file with a 400 and stores nothing', async () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]); // legacy .doc
    const result = await submitForm(db, env.MEDIA_BUCKET, form, fields, parsedWith({ document: new File([doc], 'cv.doc') }), {
      isTest: false,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await storedState()).toEqual(EMPTY);
  });
});

describe('uploadMessageFiles (real D1 + R2)', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await env.DB.exec('DELETE FROM media_attachments');
    await env.DB.exec('DELETE FROM media');
    const listed = await env.MEDIA_BUCKET.list();
    if (listed.objects.length) await env.MEDIA_BUCKET.delete(listed.objects.map((object) => object.key));
  });

  it('removes the files already stored when a later file fails to store', async () => {
    const result = await uploadMessageFiles(db, bucketFailingOnPut(2), [
      { filename: 'a.pdf', bytes: pdf() },
      { filename: 'b.pdf', bytes: pdf() },
    ]);
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(await storedState()).toEqual(EMPTY);
  });

  it('removes the files already stored when a later file is rejected', async () => {
    const result = await uploadMessageFiles(db, env.MEDIA_BUCKET, [
      { filename: 'a.pdf', bytes: pdf() },
      { filename: 'b.exe', bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) },
    ]);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await storedState()).toEqual(EMPTY);
  });
});
