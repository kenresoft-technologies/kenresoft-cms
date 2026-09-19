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
});
