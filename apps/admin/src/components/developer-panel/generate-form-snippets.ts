import type { Form, FormField, FormFieldType } from '@/lib/types';
import type { DeveloperSnippets } from './generate-snippets';

// Mirrors exampleValueForField in generate-snippets.ts, but for FormFieldType — a distinct,
// smaller union from content-type FieldType (packages/contracts/schemas/enums.ts), so it isn't
// a shared function.
function exampleValueForFormField(field: FormField): unknown {
  const options = (field.config?.options as string[] | undefined) ?? [];

  switch (field.fieldType as FormFieldType) {
    case 'number':
      return 42;
    case 'checkbox':
      return true;
    case 'date':
      return '2026-08-28';
    case 'select':
      return options[0] ?? 'option-1';
    case 'email':
      return 'name@example.com';
    case 'url':
      return 'https://example.com';
    default:
      return `Example ${field.label}`;
  }
}

export function exampleFormSubmissionData(fields: FormField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, exampleValueForFormField(field)]));
}

export interface ExampleFormSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  status: 'new';
  createdAt: string;
}

export function buildExampleFormSubmission(form: Form, fields: FormField[]): ExampleFormSubmission {
  return {
    id: 'submission-id',
    formId: form.id,
    data: exampleFormSubmissionData(fields),
    status: 'new',
    createdAt: '2026-08-28T12:00:00.000Z',
  };
}

// The submission endpoint is unauthenticated but rate limited (5 requests/60s per IP) and
// validates + sanitizes dynamically against this form's own fields (apps/api/src/lib/
// form-submission-validation.ts) — there's no fixed request-body schema to generate types
// from, so unlike content types this doesn't produce a TypeScript interface, just the literal
// example payload.
export function buildFormSnippets({
  apiUrl,
  form,
  fields,
}: {
  apiUrl: string;
  form: Form;
  fields: FormField[];
}): DeveloperSnippets {
  const path = `/api/v1/public/forms/${form.slug}/submissions`;
  const exampleData = exampleFormSubmissionData(fields);
  const dataLiteral = JSON.stringify(exampleData, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');

  const astro = `import { createKenresoftClient } from '@kenresoft/astro';

const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_CMS_URL });

await cms.forms.submit({
  formSlug: '${form.slug}',
  data: ${dataLiteral},
});`;

  const typescript = `const response = await fetch('${apiUrl}${path}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${dataLiteral}),
});

if (!response.ok) {
  const { issues } = await response.json();
  // handle validation errors
}`;

  const javascript = `const response = await fetch('${apiUrl}${path}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${dataLiteral}),
});

if (!response.ok) {
  const { issues } = await response.json();
  // handle validation errors
}`;

  const react = `async function handleSubmit(formData) {
  const response = await fetch('${apiUrl}${path}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  });
  return response.ok;
}`;

  const nextjs = `'use client';

async function handleSubmit(formData) {
  const response = await fetch('${apiUrl}${path}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  });
  return response.ok;
}`;

  const curl = `curl -X POST '${apiUrl}${path}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(exampleData)}'`;

  return { astro, typescript, javascript, react, nextjs, curl };
}
