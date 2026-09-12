// Pure unit tests for the Phase 1 field-renderer registry (docs/SITE_BUILDER.md), run via
// Node's own test runner rather than a bundler-backed one — this package has no HTTP surface
// and no framework runtime to spin up (see scripts/lib/*.test.mjs for the same "pure logic,
// node --test" precedent already established elsewhere in this monorepo). Run with
// `pnpm --filter @kenresoft-cms/astro test`.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  registerFieldRenderer,
  renderField,
  resolveFieldRenderer,
  type FieldRenderer,
  type RenderableField,
} from '../src/render/field-renderers.ts';

function field(overrides: Partial<RenderableField> = {}): RenderableField {
  return { fieldType: 'text', label: 'Title', ...overrides };
}

describe('renderField — default resolution (no presentation metadata)', () => {
  it('presentation omitted entirely renders using the fieldType default', () => {
    const f: RenderableField = { fieldType: 'text', label: 'Title' };
    assert.deepEqual(renderField(f, 'Hello'), { kind: 'text', value: 'Hello' });
  });

  it('presentation explicitly null renders identically to presentation omitted', () => {
    const f = field({ presentation: null });
    assert.deepEqual(renderField(f, 'Hello'), { kind: 'text', value: 'Hello' });
  });

  it('rich_text defaults to the html renderer', () => {
    const f = field({ fieldType: 'rich_text' });
    assert.deepEqual(renderField(f, '<p>Hi</p>'), { kind: 'html', value: '<p>Hi</p>' });
  });

  it('number defaults to the number renderer and coerces numeric strings', () => {
    const f = field({ fieldType: 'number' });
    assert.deepEqual(renderField(f, 42), { kind: 'number', value: 42 });
    assert.deepEqual(renderField(f, '7'), { kind: 'number', value: 7 });
  });

  it('boolean defaults to the boolean renderer', () => {
    const f = field({ fieldType: 'boolean' });
    assert.deepEqual(renderField(f, true), { kind: 'boolean', value: true });
    assert.deepEqual(renderField(f, undefined), { kind: 'boolean', value: false });
  });

  it('date/datetime default to the date renderer', () => {
    assert.deepEqual(renderField(field({ fieldType: 'date' }), '2026-01-01'), { kind: 'date', value: '2026-01-01' });
    assert.deepEqual(renderField(field({ fieldType: 'datetime' }), '2026-01-01T00:00:00Z'), {
      kind: 'date',
      value: '2026-01-01T00:00:00Z',
    });
  });

  it('url defaults to the link renderer, carrying the field label', () => {
    const f = field({ fieldType: 'url', label: 'Website' });
    assert.deepEqual(renderField(f, 'https://example.com'), {
      kind: 'link',
      href: 'https://example.com',
      label: 'Website',
    });
  });

  it('media defaults to the image renderer', () => {
    const f = field({ fieldType: 'media' });
    assert.deepEqual(renderField(f, 'media-id-1'), { kind: 'image', mediaId: 'media-id-1' });
  });

  it('reference defaults to the relation renderer', () => {
    const f = field({ fieldType: 'reference' });
    assert.deepEqual(renderField(f, 'entry-id-1'), { kind: 'relation', entryId: 'entry-id-1' });
  });

  it('multi_select defaults to the list renderer', () => {
    const f = field({ fieldType: 'multi_select' });
    assert.deepEqual(renderField(f, ['red', 'green']), {
      kind: 'list',
      items: [
        { kind: 'text', value: 'red' },
        { kind: 'text', value: 'green' },
      ],
    });
  });

  it('empty/nullish values render as { kind: "empty" } rather than "null"/"undefined" text', () => {
    assert.deepEqual(renderField(field({ fieldType: 'text' }), null), { kind: 'empty' });
    assert.deepEqual(renderField(field({ fieldType: 'text' }), undefined), { kind: 'empty' });
    assert.deepEqual(renderField(field({ fieldType: 'url' }), ''), { kind: 'empty' });
    assert.deepEqual(renderField(field({ fieldType: 'multi_select' }), []), { kind: 'empty' });
  });
});

describe('resolveFieldRenderer — precedence and overrides', () => {
  afterEach(() => {
    // Restore every built-in name a test below may have overridden, so tests stay isolated
    // against the module-scoped registry (registerFieldRenderer has no "unregister").
    registerFieldRenderer('text', ((_field, value) =>
      value === null || value === undefined || value === '' ? { kind: 'empty' } : { kind: 'text', value: String(value) }) as FieldRenderer);
  });

  it('an explicit presentation.renderer wins over the fieldType default', () => {
    const upper: FieldRenderer = (_field, value) => ({ kind: 'text', value: String(value).toUpperCase() });
    registerFieldRenderer('shout', upper);

    const f = field({ fieldType: 'text', presentation: { renderer: 'shout' } });
    assert.deepEqual(renderField(f, 'hello'), { kind: 'text', value: 'HELLO' });
  });

  it('an unregistered presentation.renderer name falls back to the fieldType default instead of throwing', () => {
    const f = field({ fieldType: 'text', presentation: { renderer: 'does-not-exist' } });
    assert.doesNotThrow(() => renderField(f, 'hello'));
    assert.deepEqual(renderField(f, 'hello'), { kind: 'text', value: 'hello' });
  });

  it('overriding a built-in renderer name changes the default for every field using it', () => {
    registerFieldRenderer('text', ((_field, value) => ({ kind: 'text', value: `<${String(value)}>` })) as FieldRenderer);

    const f = field({ fieldType: 'text' });
    assert.deepEqual(renderField(f, 'hi'), { kind: 'text', value: '<hi>' });
  });

  it('registration order does not matter — only the last registration for a given name wins', () => {
    registerFieldRenderer('shout2', (() => ({ kind: 'text', value: 'first' })) as FieldRenderer);
    registerFieldRenderer('shout2', (() => ({ kind: 'text', value: 'second' })) as FieldRenderer);

    const f = field({ fieldType: 'text', presentation: { renderer: 'shout2' } });
    assert.deepEqual(renderField(f, 'x'), { kind: 'text', value: 'second' });
  });

  it('an unsupported/unknown fieldType falls back to the safe text-stringifying renderer', () => {
    // Simulates an older client talking to a CMS that has shipped a newer FieldType this
    // registry has no default entry for — must degrade to plain text, never throw.
    const f = { fieldType: 'future_type' as RenderableField['fieldType'], label: 'Mystery' };
    const renderer = resolveFieldRenderer(f);
    assert.deepEqual(renderer(f, 'raw value'), { kind: 'text', value: 'raw value' });
  });

  it('presentation metadata is never executed — a renderer name is only ever a Map lookup key', () => {
    // A "renderer" value can never be interpreted as code: passing something that would only
    // be dangerous if eval'd/dynamically-imported must resolve exactly like any other
    // unregistered string — plain fallback to the fieldType default, nothing else happens.
    const f = field({ fieldType: 'text', presentation: { renderer: 'require("child_process")' } });
    assert.deepEqual(renderField(f, 'safe'), { kind: 'text', value: 'safe' });
  });
});
