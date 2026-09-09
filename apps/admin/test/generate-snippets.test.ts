import { describe, expect, it } from 'vitest';

import {
  buildDeveloperSnippets,
  buildEntrySnippets,
  buildExampleEntry,
  exampleEntryData,
} from '@/components/developer-panel/generate-snippets';
import type { ContentType, FieldDefinition } from '@/lib/types';

const contentType: ContentType = {
  id: 'ct-1',
  name: 'Product',
  slug: 'product',
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function field(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: overrides.name ?? 'field-id',
    contentTypeId: 'ct-1',
    name: 'field',
    label: 'Field',
    fieldType: 'text',
    required: false,
    sortOrder: 0,
    config: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('exampleEntryData', () => {
  it('derives a value per field from its type, not a hardcoded shape', () => {
    const fields = [
      field({ name: 'name', label: 'Name', fieldType: 'text' }),
      field({ name: 'price', label: 'Price', fieldType: 'number' }),
      field({ name: 'inStock', label: 'In stock', fieldType: 'boolean' }),
      field({
        name: 'category',
        label: 'Category',
        fieldType: 'select',
        config: { options: ['Shoes', 'Apparel'] },
      }),
      field({ name: 'image', label: 'Image', fieldType: 'media' }),
      field({ name: 'related', label: 'Related', fieldType: 'reference' }),
    ];

    const data = exampleEntryData(fields);

    expect(data).toEqual({
      name: 'Example Name',
      price: 42,
      inStock: true,
      category: 'Shoes',
      image: 'media-id',
      related: 'entry-id',
    });
  });

  it('falls back to the first option only when the select field actually has options', () => {
    const data = exampleEntryData([field({ name: 'category', fieldType: 'select', config: null })]);
    expect(data.category).toBe('option-1');
  });

  it('produces no fields for a content type with none yet', () => {
    expect(exampleEntryData([])).toEqual({});
  });
});

describe('buildExampleEntry', () => {
  it('uses the real content type id, not a placeholder', () => {
    const entry = buildExampleEntry(contentType, []);
    expect(entry.contentTypeId).toBe('ct-1');
    expect(entry.status).toBe('published');
    expect(entry.publishAt).toBeNull();
  });
});

describe('buildDeveloperSnippets', () => {
  const fields = [field({ name: 'title', label: 'Title', fieldType: 'text', required: true })];

  it('points every snippet at the real content-type slug and configured API URL', () => {
    const snippets = buildDeveloperSnippets({
      apiUrl: 'https://cms.example.com',
      contentType,
      fields,
    });

    expect(snippets.astro).toContain("contentType: 'product'");
    expect(snippets.typescript).toContain('https://cms.example.com/api/v1/public/product');
    expect(snippets.javascript).toContain('https://cms.example.com/api/v1/public/product');
    expect(snippets.curl).toContain("curl 'https://cms.example.com/api/v1/public/product'");
    expect(snippets.curl).toContain("curl 'https://cms.example.com/api/v1/public/product/your-entry-slug'");
  });

  it('reflects required fields in the generated TypeScript interface', () => {
    const snippets = buildDeveloperSnippets({ apiUrl: 'http://localhost:8787', contentType, fields });
    expect(snippets.typescript).toContain('title: string;');
    expect(snippets.typescript).not.toContain('title?: string;');
  });
});

describe('buildEntrySnippets', () => {
  it('addresses the real, already-saved entry slug instead of a placeholder', () => {
    const snippets = buildEntrySnippets({
      apiUrl: 'https://cms.example.com',
      contentType,
      entrySlug: 'first-post',
    });

    expect(snippets.astro).toContain("slug: 'first-post'");
    expect(snippets.curl).toBe("curl 'https://cms.example.com/api/v1/public/product/first-post'");
    expect(snippets.typescript).toContain('https://cms.example.com/api/v1/public/product/first-post');
    expect(snippets.typescript).not.toContain('your-entry-slug');
  });
});
