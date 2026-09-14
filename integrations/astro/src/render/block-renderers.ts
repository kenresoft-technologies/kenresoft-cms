// Block renderer override registry — Phase 7 of the schema-driven frontend work
// (docs/SITE_BUILDER.md §6). A block's DATA (`BlockInstance.type`/`config`/`children`) is
// already a complete description of what to render — unlike a field value, it needs no
// translation into a generic display shape (see field-renderers.ts's own doc comment on why
// that translation exists there). What a block genuinely needs resolved is which COMPONENT
// renders a given `type` string, and that resolution is inherently framework-specific (an
// Astro component, a React component, ...) — this package has no Astro/React/JSX dependency at
// all (see field-renderers.ts's own note on this), so it cannot itself hold real components.
//
// This module therefore holds ONLY the developer-override half of block resolution — a
// deliberate, documented deviation from docs/SITE_BUILDER.md §5/§6's original sketch (which
// imagined the SDK also shipping the built-in Hero/RichText/Image/CTA/Columns/Spacer
// components). The actual built-in components live in `examples/astro-site/src/components/
// blocks/` instead, the one real Astro consumer that can hold `.astro` files at all, combined
// with this registry as: `resolveBlockRenderer(type) ?? BUILT_IN_BLOCKS[type]`. This keeps
// "an explicit override always wins over a built-in default" true regardless of import order —
// the override and the built-in default are two genuinely separate maps a caller combines
// itself, not one mutable map where later registration could silently clobber an earlier one.

export type BlockComponent = unknown;

const overrides = new Map<string, BlockComponent>();

/**
 * Register (or override) the component used to render a block type. Registering under an
 * existing name REPLACES it — the last call for a given name wins. Call this before rendering
 * any page (e.g. in an Astro integration's own setup, or at the top of a shared layout module).
 */
export function registerBlockRenderer(blockType: string, component: BlockComponent): void {
  overrides.set(blockType, component);
}

/**
 * Look up a developer-registered override for a block type, or `undefined` if none was
 * registered — callers combine this with their own built-in default map (see this file's own
 * top comment), so `undefined` here does NOT mean "nothing can render this block," only "no
 * override was registered for it."
 */
export function resolveBlockRenderer(blockType: string): BlockComponent | undefined {
  return overrides.get(blockType);
}
