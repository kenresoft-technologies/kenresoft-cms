import { BLOCK_TYPES } from '@/lib/types';
import type { BlockType } from '@/lib/types';

// Admin-side companion to packages/contracts/schemas/blocks.ts's BLOCK_CONFIG_SCHEMAS — drives
// a generic form for each block type's `config` (docs/SITE_BUILDER.md §1.9's own registry-array
// idiom, matching SETTINGS_SECTIONS/pluginNavItems rather than inventing per-block-type
// components). The API is still the source of truth for what's actually valid; this only needs
// to be "close enough" to build a usable form — a stale or missing entry here just means a
// plainer editing experience, never a security or validation gap.
export interface BlockFieldDef {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'url' | 'number' | 'media' | 'richtext';
  placeholder?: string;
}

export interface BlockTypeDef {
  type: BlockType;
  label: string;
  description: string;
  allowsChildren: boolean;
  fields: BlockFieldDef[];
}

export const BLOCK_TYPE_REGISTRY: BlockTypeDef[] = [
  {
    type: 'hero',
    label: 'Hero',
    description: 'A large heading with an optional image and call-to-action.',
    allowsChildren: false,
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'subheading', label: 'Subheading', kind: 'textarea' },
      { key: 'imageMediaId', label: 'Image', kind: 'media' },
      { key: 'ctaLabel', label: 'Button label', kind: 'text' },
      { key: 'ctaUrl', label: 'Button link', kind: 'url' },
    ],
  },
  {
    type: 'richText',
    label: 'Rich text',
    description: 'A block of formatted text, using the same editor as a rich_text field.',
    allowsChildren: false,
    fields: [{ key: 'html', label: 'Content', kind: 'richtext' }],
  },
  {
    type: 'image',
    label: 'Image',
    description: 'A single image from the Media Library.',
    allowsChildren: false,
    fields: [
      { key: 'mediaId', label: 'Image', kind: 'media' },
      { key: 'altText', label: 'Alt text', kind: 'text' },
      { key: 'caption', label: 'Caption', kind: 'text' },
    ],
  },
  {
    type: 'cta',
    label: 'Call to action',
    description: 'A heading and a button linking somewhere.',
    allowsChildren: false,
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'buttonLabel', label: 'Button label', kind: 'text' },
      { key: 'buttonUrl', label: 'Button link', kind: 'url' },
    ],
  },
  {
    type: 'columns',
    label: 'Columns',
    description: 'Lays out its nested blocks side by side.',
    allowsChildren: true,
    fields: [{ key: 'columnCount', label: 'Number of columns', kind: 'number', placeholder: '2' }],
  },
  {
    type: 'spacer',
    label: 'Spacer',
    description: 'Empty vertical space between blocks.',
    allowsChildren: false,
    fields: [{ key: 'height', label: 'Height (px)', kind: 'number', placeholder: '40' }],
  },
];

export function getBlockTypeDef(type: BlockType): BlockTypeDef | undefined {
  return BLOCK_TYPE_REGISTRY.find((def) => def.type === type);
}

export function isContainerBlockType(type: BlockType): boolean {
  return getBlockTypeDef(type)?.allowsChildren ?? false;
}

// Every BLOCK_TYPES value is expected to have a registry entry — verified by
// PagesPage/PageEditorPage tests, not enforced at the type level (the two lists genuinely come
// from different packages: BLOCK_TYPES is the runtime-validated source of truth, this registry
// is presentation-only).
export function newBlockId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export const ALL_BLOCK_TYPES: readonly BlockType[] = BLOCK_TYPES;
