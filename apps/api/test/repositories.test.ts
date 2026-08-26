import { env } from 'cloudflare:test';
import { createDb } from '@kenresoft/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { createContentType, getContentTypeBySlug } from '../src/repositories/content-types';
import { createFieldDefinition, listFieldDefinitionsForContentType } from '../src/repositories/field-definitions';
import { createEntry, getEntryBySlug, listEntryRevisions, updateEntry } from '../src/repositories/entries';

const db = createDb(env.DB);

describe('domain model repositories (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
  });

  it('walks the content type -> field -> entry graph', async () => {
    const contentType = await createContentType(db, {
      name: 'Blog Post',
      slug: 'blog-post',
      description: null,
    });
    expect(await getContentTypeBySlug(db, 'blog-post')).toMatchObject({
      id: contentType.id,
    });

    await createFieldDefinition(db, {
      contentTypeId: contentType.id,
      name: 'title',
      label: 'Title',
      fieldType: 'text',
      required: true,
      sortOrder: 0,
      config: null,
    });
    const fields = await listFieldDefinitionsForContentType(db, contentType.id);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ name: 'title', fieldType: 'text', required: true });

    const entry = await createEntry(
      db,
      contentType.id,
      { slug: 'hello-world', status: 'draft', data: { title: 'Hello World' } },
      null,
    );
    expect(await getEntryBySlug(db, contentType.id, 'hello-world')).toMatchObject({
      id: entry.id,
      status: 'draft',
    });

    const published = await updateEntry(db, entry.id, { status: 'published' }, null);
    expect(published?.status).toBe('published');

    const revisions = await listEntryRevisions(db, entry.id);
    expect(revisions).toHaveLength(2);
    // Newest first: the pre-update ("draft") snapshot, then the initial creation snapshot.
    expect(revisions[0]).toMatchObject({ status: 'draft', data: { title: 'Hello World' } });
    expect(revisions[1]).toMatchObject({ status: 'draft', data: { title: 'Hello World' } });
  });

  it('rejects an entry for a non-existent content type', async () => {
    await expect(
      createEntry(db, 'does-not-exist', { slug: 'x', status: 'draft', data: {} }, null),
    ).rejects.toThrow('Content type does-not-exist not found');
  });

  it('enforces a unique content type slug at the DB layer', async () => {
    await createContentType(db, { name: 'Blog Post', slug: 'blog-post', description: null });
    await expect(
      createContentType(db, { name: 'Duplicate', slug: 'blog-post', description: null }),
    ).rejects.toThrow();
  });
});
