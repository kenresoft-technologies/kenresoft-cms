// Read-only field rendering — Phase 1 of the schema-driven frontend work (docs/SITE_BUILDER.md).
//
// This module resolves a field's DATA VALUE into a small, display-oriented shape a frontend
// template can switch on, without that template needing to know every FieldType by hand. It is
// deliberately independent of apps/admin's editing components (@/components/field-input.tsx) —
// that package renders *editable widgets* for an authenticated admin; this one renders *static
// display output* for an anonymous visitor, a different concern with a different (framework-
// agnostic, non-JSX) shape, since this package has no Astro/React/JSX dependency at all (it's a
// plain fetch-wrapper client — see package.json's own description).
//
// WHAT THIS DOES NOT DO YET (Phase 1 is renderer/registry foundation only, not Pages/Blocks):
// there is no public API endpoint yet that returns a content type's field definitions (including
// `presentation`) to a frontend — docs/SITE_BUILDER.md §5/§9 flags this as a known, already-
// documented gap (see docs/ASTRO.md's "Known limitations"), not something silently overlooked.
// A caller who already has a field's `{fieldType, label, presentation}` (e.g. because Pages/
// Blocks in a later phase attaches it, or because a project fetches it via its own admin
// session) can use `renderField()` today; there is no `client.contentTypes.fields()` call yet.

import type { FieldPresentation, FieldType } from '@kenresoft-cms/contracts';

export type { FieldPresentation, FieldType };

/** The minimal field description `renderField()` needs — a subset of the real `FieldDefinition`. */
export interface RenderableField {
  fieldType: FieldType;
  label: string;
  presentation?: FieldPresentation | null;
}

// A closed, discriminated set of display shapes — deliberately NOT raw HTML-per-field-type,
// so a consuming template decides how each `kind` actually renders (text node, <img>, <a>,
// etc.) rather than this package emitting markup opinions. The one exception is `html`
// (rich_text), which is already stored as trusted, editor-authored HTML server-side — the
// same trust boundary apps/admin's own rich-text preview and examples/astro-site's
// `set:html` usage already rely on; this renderer does not introduce a new one.
export type FieldRenderResult =
  | { kind: 'text'; value: string }
  | { kind: 'html'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'image'; mediaId: string }
  | { kind: 'relation'; entryId: string }
  | { kind: 'list'; items: FieldRenderResult[] }
  | { kind: 'empty' };

export type FieldRenderer = (field: RenderableField, value: unknown) => FieldRenderResult;

function toText(value: unknown): FieldRenderResult {
  if (value === null || value === undefined || value === '') return { kind: 'empty' };
  return { kind: 'text', value: String(value) };
}

const TextRenderer: FieldRenderer = (_field, value) => toText(value);

const RichTextRenderer: FieldRenderer = (_field, value) =>
  typeof value === 'string' && value.length > 0 ? { kind: 'html', value } : { kind: 'empty' };

const NumberRenderer: FieldRenderer = (_field, value) => {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? { kind: 'number', value: num } : { kind: 'empty' };
};

const BooleanRenderer: FieldRenderer = (_field, value) => ({ kind: 'boolean', value: Boolean(value) });

const DateRenderer: FieldRenderer = (_field, value) =>
  typeof value === 'string' && value.length > 0 ? { kind: 'date', value } : { kind: 'empty' };

const LinkRenderer: FieldRenderer = (field, value) =>
  typeof value === 'string' && value.length > 0 ? { kind: 'link', href: value, label: field.label } : { kind: 'empty' };

const ImageRenderer: FieldRenderer = (_field, value) =>
  typeof value === 'string' && value.length > 0 ? { kind: 'image', mediaId: value } : { kind: 'empty' };

const RelationRenderer: FieldRenderer = (_field, value) =>
  typeof value === 'string' && value.length > 0 ? { kind: 'relation', entryId: value } : { kind: 'empty' };

const ListRenderer: FieldRenderer = (field, value) => {
  if (!Array.isArray(value) || value.length === 0) return { kind: 'empty' };
  return { kind: 'list', items: value.map((item) => TextRenderer(field, item)) };
};

/**
 * Safe fallback — used only for a `fieldType` this version of the renderer registry has never
 * heard of (e.g. an older frontend build talking to a CMS that shipped a newer field type).
 * Stringifies whatever it's given rather than throwing, so an unrecognized field degrades to
 * plain text instead of breaking the page.
 */
const FallbackRenderer: FieldRenderer = (_field, value) => toText(value);

// Renderer NAMES are the resolution key — deliberately a separate namespace from FieldType, so
// one renderer can serve several field types (see DEFAULT_RENDERER_BY_FIELD_TYPE below) and a
// developer can register a brand-new name a field's `presentation.renderer` opts into, without
// that name needing to match any FieldType at all.
const BUILT_IN_RENDERERS: Record<string, FieldRenderer> = {
  text: TextRenderer,
  richText: RichTextRenderer,
  number: NumberRenderer,
  boolean: BooleanRenderer,
  date: DateRenderer,
  link: LinkRenderer,
  image: ImageRenderer,
  relation: RelationRenderer,
  list: ListRenderer,
};

const DEFAULT_RENDERER_BY_FIELD_TYPE: Record<FieldType, string> = {
  text: 'text',
  textarea: 'text',
  rich_text: 'richText',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'date',
  slug: 'text',
  email: 'text',
  url: 'link',
  select: 'text',
  multi_select: 'list',
  media: 'image',
  reference: 'relation',
};

// A registry a developer can extend/override — module-scoped, mutated only via
// `registerFieldRenderer()`. Starts as a shallow copy of the built-ins so restoring a name to
// its default (re-registering it) never mutates the frozen source map.
const registry = new Map<string, FieldRenderer>(Object.entries(BUILT_IN_RENDERERS));

/**
 * Register (or override) a named field renderer. Registering under an existing name — including
 * one of the built-in names above — REPLACES it; the last call for a given name always wins,
 * which is what makes "developer override beats built-in default" (see `resolveFieldRenderer`)
 * actually deterministic rather than order-dependent.
 *
 * Security note: `name` and every `presentation.renderer` value that references it are plain
 * strings used only as a Map key into this in-memory registry of already-compiled functions —
 * never `eval`'d, never dynamically imported, never interpreted as a template. An admin cannot
 * cause code execution by entering a renderer name; at worst, an unrecognized name simply falls
 * through to the field's default renderer (see below). Only a developer's own trusted source
 * code can ever call this function.
 */
export function registerFieldRenderer(name: string, renderer: FieldRenderer): void {
  registry.set(name, renderer);
}

/**
 * Deterministic renderer resolution, in this exact precedence order:
 *
 *   1. `field.presentation.renderer` — IF that name is registered (built-in or developer-
 *      registered). An unregistered name here does NOT throw; it falls through to step 2,
 *      since a mistyped or not-yet-registered renderer name shouldn't break the page.
 *   2. The default renderer for `field.fieldType` (DEFAULT_RENDERER_BY_FIELD_TYPE), which is
 *      itself just a registry lookup — so a developer overriding a BUILT-IN name (e.g.
 *      re-registering "text") transparently changes the default for every field that doesn't
 *      set its own `presentation.renderer`, with no special-casing needed here.
 *   3. `FallbackRenderer` — only reached for a `fieldType` this registry has no default entry
 *      for at all (see FallbackRenderer's own doc comment).
 *
 * This order is the answer to "resolution order must be documented" (docs/SITE_BUILDER.md §6):
 * an explicit `presentation.renderer` override always wins over a built-in default, and
 * registration order/timing never matters — only whether a name is registered *at the moment
 * this function runs*, which for a request-scoped SSR render is after a developer's own
 * integration setup has already run every `registerFieldRenderer()` call it's going to make.
 */
export function resolveFieldRenderer(field: RenderableField): FieldRenderer {
  const explicit = field.presentation?.renderer;
  if (explicit) {
    const registered = registry.get(explicit);
    if (registered) return registered;
  }

  const defaultName = DEFAULT_RENDERER_BY_FIELD_TYPE[field.fieldType];
  const byDefault = defaultName ? registry.get(defaultName) : undefined;
  return byDefault ?? FallbackRenderer;
}

/** Resolve and immediately invoke the right renderer for `field` against `value`. */
export function renderField(field: RenderableField, value: unknown): FieldRenderResult {
  return resolveFieldRenderer(field)(field, value);
}
