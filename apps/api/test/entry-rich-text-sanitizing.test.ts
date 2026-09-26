import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { describe, expect, it } from 'vitest';

import { createContentType } from '../src/repositories/content-types';
import { createEntry } from '../src/repositories/entries';
import { createFieldDefinition } from '../src/repositories/field-definitions';

const db = createDb(env.DB);
const EVIL = '<h2>Hi</h2><img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>';

function expectClean(html: string) {
  expect(html).toContain('<h2>Hi</h2>');
  for (const bad of ['<script', 'onerror', 'javascript:', 'alert']) expect(html).not.toContain(bad);
}

describe('entry rich_text fields are sanitised', () => {
  it('cleans on write, and again on public read for older dirty rows; other fields untouched', async () => {
    const ct = await createContentType(db, { name: 'Post', slug: 'post', description: null });
    for (const [name, fieldType, sortOrder] of [
      ['body', 'rich_text', 0],
      ['note', 'text', 1],
    ] as const) {
      await createFieldDefinition(db, {
        contentTypeId: ct.id,
        name,
        label: name,
        fieldType,
        required: false,
        sortOrder,
        config: null,
        presentation: null,
      });
    }

    const entry = await createEntry(
      db,
      ct.id,
      { slug: 'a', status: 'published', data: { body: EVIL, note: '<b>plain</b>' } },
      null,
    );
    expectClean(entry.data['body'] as string);
    expect(entry.data['note']).toBe('<b>plain</b>');

    // A row written before write-time sanitising existed.
    await env.DB.prepare('UPDATE entries SET data = ? WHERE id = ?')
      .bind(JSON.stringify({ body: EVIL, note: 'n' }), entry.id)
      .run();
    const res = await SELF.fetch('https://example.com/api/v1/public/post/a');
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { body: string } }>();
    expectClean(body.data.body);
  });

  it('keeps an editor checklist through save and public read', async () => {
    const ct = await createContentType(db, { name: 'Post', slug: 'post', description: null });
    await createFieldDefinition(db, {
      contentTypeId: ct.id,
      name: 'body',
      label: 'body',
      fieldType: 'rich_text',
      required: false,
      sortOrder: 0,
      config: null,
      presentation: null,
    });
    // What the admin editor sends (apps/admin's toStoredRichTextHtml).
    const checklist =
      '<ul data-type="taskList" style="list-style: none"><li data-checked="true" data-type="taskItem"><input type="checkbox" checked="checked" disabled="">Book venue</li></ul>';
    const saved =
      '<ul data-type="taskList" style="list-style: none"><li data-checked="true" data-type="taskItem"><input type="checkbox" disabled checked style="display: inline-block; width: auto; margin: 0 0.4em 0 0">Book venue</li></ul>';

    const entry = await createEntry(db, ct.id, { slug: 'b', status: 'published', data: { body: checklist } }, null);
    expect(entry.data['body']).toBe(saved);

    const res = await SELF.fetch('https://example.com/api/v1/public/post/b');
    expect(res.status).toBe(200);
    expect((await res.json<{ data: { body: string } }>()).data.body).toBe(saved);

    // A checklist saved before the flat shape existed (checkbox in a <label>, text in a <div><p>),
    // written straight to the row: the public API serves it in the one-line shape without a re-save.
    await env.DB.prepare('UPDATE entries SET data = ? WHERE id = ?')
      .bind(
        JSON.stringify({
          body: '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" disabled checked style="display: inline-block; width: auto; margin: 0 0.4em 0 0"><span></span></label><div><p>Book venue</p></div></li></ul>',
        }),
        entry.id,
      )
      .run();
    const legacy = await SELF.fetch('https://example.com/api/v1/public/post/b');
    expect(legacy.status).toBe(200);
    expect((await legacy.json<{ data: { body: string } }>()).data.body).toBe(saved);
  });
});
