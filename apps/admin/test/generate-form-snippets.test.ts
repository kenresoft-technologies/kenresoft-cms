import { describe, expect, it } from 'vitest';

import {
  buildExampleFormSubmission,
  buildFormSnippets,
  exampleFormSubmissionData,
} from '@/components/developer-panel/generate-form-snippets';
import type { Form, FormField } from '@/lib/types';

const form: Form = {
  id: 'form-1',
  name: 'Contact',
  slug: 'contact',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function field(overrides: Partial<FormField>): FormField {
  return {
    id: overrides.name ?? 'field-id',
    formId: 'form-1',
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

describe('exampleFormSubmissionData', () => {
  it('derives a value per field from its FormFieldType', () => {
    const fields = [
      field({ name: 'email', label: 'Email', fieldType: 'email' }),
      field({ name: 'subscribe', label: 'Subscribe', fieldType: 'checkbox' }),
      field({ name: 'visitDate', label: 'Visit date', fieldType: 'date' }),
      field({
        name: 'topic',
        label: 'Topic',
        fieldType: 'select',
        config: { options: ['Sales', 'Support'] },
      }),
    ];

    expect(exampleFormSubmissionData(fields)).toEqual({
      email: 'name@example.com',
      subscribe: true,
      visitDate: '2026-08-28',
      topic: 'Sales',
    });
  });
});

describe('buildExampleFormSubmission', () => {
  it('uses the real form id and a "new" status', () => {
    const submission = buildExampleFormSubmission(form, []);
    expect(submission.formId).toBe('form-1');
    expect(submission.status).toBe('new');
  });
});

describe('buildFormSnippets', () => {
  const fields = [field({ name: 'email', label: 'Email', fieldType: 'email', required: true })];

  it('targets the real form slug submission endpoint', () => {
    const snippets = buildFormSnippets({ apiUrl: 'https://cms.example.com', form, fields });

    expect(snippets.astro).toContain("formSlug: 'contact'");
    expect(snippets.curl).toContain("'https://cms.example.com/api/v1/public/forms/contact/submissions'");
    expect(snippets.curl).toContain('-X POST');
    expect(snippets.typescript).toContain('name@example.com');
  });
});
