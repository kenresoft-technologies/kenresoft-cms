import { z } from 'zod';

import { BLOCK_TYPES, BLOCK_TYPES_ALLOWING_CHILDREN } from './enums';
import type { BlockType } from './enums';

// Phase 3 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.3): a Page's block
// composition tree, stored inline as `pages.blocks` JSON — never a normalized table (§3.3's
// own rationale: blocks are never queried relationally, and a JSON tree makes revisioning a
// plain column snapshot). `config` is intentionally untyped at the schema level (a plain
// record) — each block type's own shape is enforced separately below by
// BLOCK_CONFIG_SCHEMAS/validateBlockTree, the same two-layer approach entries.data already
// uses (Zod for the envelope, a second per-type check for the payload).
//
// Deliberately capped at two tiers (a block, and that block's non-nesting children) rather than
// a true recursive tree (which would need `z.lazy()`): @hono/zod-openapi's document generator
// can't serialize a self-referential z.lazy schema from a plain (non-`@hono/zod-openapi`) zod
// instance without infinitely expanding it — confirmed empirically (the OpenAPI doc route
// crashed outright). Every built-in block type in this phase (§5's Hero/RichText/Image/CTA/
// Columns/Spacer) only ever needs one level of nesting (Columns holding simple children) — no
// product capability is lost by this cap, and it can be revisited if a future block type
// genuinely needs deeper nesting.
export type ChildBlockInstance = {
  id: string;
  type: BlockType;
  config: Record<string, unknown>;
};

export type BlockInstance = ChildBlockInstance & {
  children?: ChildBlockInstance[] | undefined;
};

const childBlockInstanceSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(BLOCK_TYPES),
  config: z.record(z.string(), z.unknown()),
});

export const blockInstanceSchema = childBlockInstanceSchema.extend({
  children: z.array(childBlockInstanceSchema).optional(),
});

export const pageBlocksSchema = z.object({ blocks: z.array(blockInstanceSchema) });

export type PageBlocks = z.infer<typeof pageBlocksSchema>;

// Per-block-type config shape (§5's built-in set: Hero, RichText, Image, CTA, Columns,
// Spacer — matching the brief's example list without over-building). Every field is optional
// enough that an empty/just-added block instance is always valid — the editor lets an admin
// fill a block in gradually rather than requiring every field before it can be saved at all.
export const HERO_BLOCK_CONFIG = z
  .object({
    heading: z.string().max(200).optional(),
    subheading: z.string().max(500).optional(),
    imageMediaId: z.string().max(100).optional(),
    ctaLabel: z.string().max(100).optional(),
    ctaUrl: z.string().max(2000).optional(),
  })
  .strict();

export const RICH_TEXT_BLOCK_CONFIG = z
  .object({
    html: z.string().max(50000).optional(),
  })
  .strict();

export const IMAGE_BLOCK_CONFIG = z
  .object({
    mediaId: z.string().max(100).optional(),
    altText: z.string().max(300).optional(),
    caption: z.string().max(500).optional(),
  })
  .strict();

export const CTA_BLOCK_CONFIG = z
  .object({
    heading: z.string().max(200).optional(),
    buttonLabel: z.string().max(100).optional(),
    buttonUrl: z.string().max(2000).optional(),
  })
  .strict();

// No other own config beyond how many columns it lays out — the actual content is whatever
// child blocks are nested inside it (§3.3).
export const COLUMNS_BLOCK_CONFIG = z
  .object({
    columnCount: z.number().int().min(2).max(4).optional(),
  })
  .strict();

export const SPACER_BLOCK_CONFIG = z
  .object({
    height: z.number().int().min(0).max(2000).optional(),
  })
  .strict();

export const BLOCK_CONFIG_SCHEMAS: Record<BlockType, z.ZodTypeAny> = {
  hero: HERO_BLOCK_CONFIG,
  richText: RICH_TEXT_BLOCK_CONFIG,
  image: IMAGE_BLOCK_CONFIG,
  cta: CTA_BLOCK_CONFIG,
  columns: COLUMNS_BLOCK_CONFIG,
  spacer: SPACER_BLOCK_CONFIG,
};

export function isBlockTypeAllowingChildren(type: BlockType): boolean {
  return (BLOCK_TYPES_ALLOWING_CHILDREN as readonly BlockType[]).includes(type);
}

// The API-layer walk `blockInstanceSchema` alone can't do: each node's `config` must match its
// own block type's schema (not just "some record"), and only a container-shaped type may carry
// `children` at all (§3.3/§7 — a block type is trusted/developer-registered behavior, so an
// admin can never nest content under a leaf type that has nowhere to render it). Returns a
// human-readable error for the first problem found, or null when the whole tree is valid.
function validateBlockConfig(block: ChildBlockInstance): string | null {
  const configSchema = BLOCK_CONFIG_SCHEMAS[block.type];
  const result = configSchema.safeParse(block.config);
  if (!result.success) {
    return `Block "${block.id}" (${block.type}) has an invalid config: ${result.error.issues[0]?.message ?? 'invalid'}`;
  }
  return null;
}

export function validateBlockTree(blocks: BlockInstance[]): string | null {
  for (const block of blocks) {
    const ownError = validateBlockConfig(block);
    if (ownError) return ownError;

    if (block.children && block.children.length > 0) {
      if (!isBlockTypeAllowingChildren(block.type)) {
        return `Block "${block.id}" (${block.type}) does not support nested blocks.`;
      }
      for (const child of block.children) {
        const childError = validateBlockConfig(child);
        if (childError) return childError;
      }
    }
  }
  return null;
}
