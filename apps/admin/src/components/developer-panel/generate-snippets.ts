import type { ContentType, FieldDefinition, FieldType } from '@/lib/types';

// A schema-aware stand-in for a real entry, so the response preview stays in sync with a
// content type's actual fields instead of a hand-written example that can drift from them
// (docs/ARCHITECTURE.md §16 principle, applied to fields rather than endpoints).
function exampleValueForField(field: FieldDefinition): unknown {
  const options = (field.config?.options as string[] | undefined) ?? [];

  switch (field.fieldType as FieldType) {
    case 'number':
      return 42;
    case 'boolean':
      return true;
    case 'date':
      return '2026-08-28';
    case 'datetime':
      return '2026-08-28T12:00:00.000Z';
    case 'select':
      return options[0] ?? 'option-1';
    case 'multi_select':
      return options.length > 0 ? options.slice(0, 2) : ['option-1'];
    case 'media':
      return 'media-id';
    case 'reference':
      return 'entry-id';
    case 'email':
      return 'name@example.com';
    case 'url':
      return 'https://example.com';
    case 'slug':
      return field.name.replace(/_/g, '-');
    case 'rich_text':
      return `<p>Example ${field.label}</p>`;
    default:
      return `Example ${field.label}`;
  }
}

export function exampleEntryData(fields: FieldDefinition[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, exampleValueForField(field)]));
}

export interface ExampleEntry {
  id: string;
  contentTypeId: string;
  slug: string;
  status: 'published';
  data: Record<string, unknown>;
  publishAt: null;
  createdAt: string;
  updatedAt: string;
}

export function buildExampleEntry(contentType: ContentType, fields: FieldDefinition[]): ExampleEntry {
  return {
    id: 'entry-id',
    contentTypeId: contentType.id,
    slug: 'your-entry-slug',
    status: 'published',
    data: exampleEntryData(fields),
    publishAt: null,
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
  };
}

function toPascalCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('');
}

function tsFieldType(field: FieldDefinition): string {
  const options = (field.config?.options as string[] | undefined) ?? [];

  switch (field.fieldType as FieldType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'select':
      return options.length > 0 ? options.map((option) => `'${option}'`).join(' | ') : 'string';
    case 'multi_select':
      return options.length > 0 ? `(${options.map((option) => `'${option}'`).join(' | ')})[]` : 'string[]';
    default:
      return 'string';
  }
}

export interface DeveloperSnippets {
  astro: string;
  typescript: string;
  javascript: string;
  react: string;
  nextjs: string;
  curl: string;
}

// Astro is first-class here — see @kenresoft-cms/astro (integrations/astro/src/index.ts), the
// only framework this CMS ships an actual client for. Every other tab is plain HTTP against
// the public API, since building framework-specific SDKs for this feature is explicitly out
// of scope.
export function buildDeveloperSnippets({
  apiUrl,
  contentType,
  fields,
}: {
  apiUrl: string;
  contentType: ContentType;
  fields: FieldDefinition[];
}): DeveloperSnippets {
  const slug = contentType.slug;
  const pascal = toPascalCase(slug) || 'Entry';
  const listPath = `/api/v1/public/${slug}`;
  const getPath = `/api/v1/public/${slug}/your-entry-slug`;
  const firstField = fields[0]?.name ?? 'id';

  const astro = `import { createKenresoftClient } from '@kenresoft-cms/astro';

const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_CMS_URL });

// List every published entry
const entries = await cms.entries.list({ contentType: '${slug}' });

// Get one entry by its slug (returns null if it doesn't exist or isn't published)
const entry = await cms.entries.get({ contentType: '${slug}', slug: 'your-entry-slug' });`;

  const typescript = `interface ${pascal}Entry {
  id: string;
  contentTypeId: string;
  slug: string;
  status: 'draft' | 'published';
  data: {
${fields.map((field) => `    ${field.name}${field.required ? '' : '?'}: ${tsFieldType(field)};`).join('\n')}
  };
  publishAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const listResponse = await fetch('${apiUrl}${listPath}');
const entries: ${pascal}Entry[] = await listResponse.json();

const entryResponse = await fetch('${apiUrl}${getPath}');
const entry: ${pascal}Entry = await entryResponse.json();`;

  const javascript = `const listResponse = await fetch('${apiUrl}${listPath}');
const entries = await listResponse.json();

const entryResponse = await fetch('${apiUrl}${getPath}');
const entry = await entryResponse.json();`;

  const react = `import { useEffect, useState } from 'react';

function ${pascal}List() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    fetch('${apiUrl}${listPath}')
      .then((res) => res.json())
      .then(setEntries);
  }, []);

  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.id}>{String(entry.data.${firstField})}</li>
      ))}
    </ul>
  );
}`;

  const nextjs = `async function get${pascal}s() {
  const res = await fetch('${apiUrl}${listPath}', { next: { revalidate: 300 } });
  return res.json();
}

export default async function Page() {
  const entries = await get${pascal}s();

  return (
    <ul>
      {entries.map((entry: { id: string; data: Record<string, unknown> }) => (
        <li key={entry.id}>{String(entry.data.${firstField})}</li>
      ))}
    </ul>
  );
}`;

  const curl = `curl '${apiUrl}${listPath}'

curl '${apiUrl}${getPath}'`;

  return { astro, typescript, javascript, react, nextjs, curl };
}

// Entry-level snippets fetch one real, already-saved slug rather than a "your-entry-slug"
// placeholder — the entry editor already has it, so there's no reason to make a developer
// substitute their own value in for this one.
export function buildEntrySnippets({
  apiUrl,
  contentType,
  entrySlug,
}: {
  apiUrl: string;
  contentType: ContentType;
  entrySlug: string;
}): DeveloperSnippets {
  const slug = contentType.slug;
  const pascal = toPascalCase(slug) || 'Entry';
  const path = `/api/v1/public/${slug}/${entrySlug}`;

  const astro = `import { createKenresoftClient } from '@kenresoft-cms/astro';

const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_CMS_URL });

// Returns null if this entry isn't published (or doesn't exist)
const entry = await cms.entries.get({ contentType: '${slug}', slug: '${entrySlug}' });`;

  const typescript = `const response = await fetch('${apiUrl}${path}');
const entry = response.ok ? await response.json() : null;`;

  const javascript = typescript;

  const react = `import { useEffect, useState } from 'react';

function ${pascal}Detail() {
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    fetch('${apiUrl}${path}')
      .then((res) => (res.ok ? res.json() : null))
      .then(setEntry);
  }, []);

  if (!entry) return null;
  return <div>{JSON.stringify(entry.data)}</div>;
}`;

  const nextjs = `async function get${pascal}() {
  const res = await fetch('${apiUrl}${path}', { next: { revalidate: 300 } });
  return res.ok ? res.json() : null;
}

export default async function Page() {
  const entry = await get${pascal}();
  if (!entry) return null;

  return <div>{JSON.stringify(entry.data)}</div>;
}`;

  const curl = `curl '${apiUrl}${path}'`;

  return { astro, typescript, javascript, react, nextjs, curl };
}
