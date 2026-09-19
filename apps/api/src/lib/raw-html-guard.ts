import { roleAtLeast } from '@kenresoft-cms/contracts';
import type { BlockInstance, UserRole } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { getSettings } from '../repositories/settings';
import { sanitizeRawHtml } from './raw-html-sanitizer';

// Every safeguard around the Site Builder's "Raw HTML" block lives here so the rules are in one
// place and every write/read path applies the same ones:
//   1. Off by default — Settings.featureFlags.rawHtmlBlocks must be turned on by an admin.
//   2. Only admins/owners can add or change a raw HTML block (an editor may still edit the rest
//      of a page that already contains one, as long as the raw block itself is unchanged).
//   3. The HTML is sanitized on every write (raw-html-sanitizer.ts) — never trust the client.
//   4. On every public read the flag is re-checked (turning it off hides all raw blocks
//      immediately — a kill switch) and the HTML is sanitized again (defense in depth).

type AnyBlock = { id: string; type: string; config: Record<string, unknown>; children?: AnyBlock[] | undefined };

export async function isRawHtmlEnabled(db: Database): Promise<boolean> {
  const settings = await getSettings(db);
  return settings?.featureFlags?.['rawHtmlBlocks'] === true;
}

function htmlOf(block: AnyBlock): string {
  const html = block.config['html'];
  return typeof html === 'string' ? html : '';
}

function collect(blocks: AnyBlock[], out: Map<string, string> = new Map()): Map<string, string> {
  for (const block of blocks) {
    if (block.type === 'rawHtml') out.set(block.id, htmlOf(block));
    if (block.children) collect(block.children, out);
  }
  return out;
}

function mapTree(blocks: AnyBlock[], fn: (block: AnyBlock) => AnyBlock | null): AnyBlock[] {
  const result: AnyBlock[] = [];
  for (const block of blocks) {
    const mapped = fn(block);
    if (!mapped) continue;
    result.push(mapped.children ? { ...mapped, children: mapTree(mapped.children, fn) } : mapped);
  }
  return result;
}

export function sanitizeRawHtmlBlocks<T extends AnyBlock>(blocks: T[]): T[] {
  return mapTree(blocks, (block) =>
    block.type === 'rawHtml'
      ? { ...block, config: { ...block.config, html: sanitizeRawHtml(htmlOf(block)) } }
      : block,
  ) as T[];
}

// The older Rich text block stores editor-authored HTML that public pages render directly, and
// any role that can edit pages can write it — so it gets the same sanitising as Raw HTML on every
// write and every public read. (Editors' toolbar output — headings, lists, links, images, tables,
// code — survives; scripts, event handlers and unsafe URLs never do.)
export function sanitizeRichTextBlocks<T extends AnyBlock>(blocks: T[]): T[] {
  return mapTree(blocks, (block) =>
    block.type === 'richText' && typeof block.config['html'] === 'string'
      ? { ...block, config: { ...block.config, html: sanitizeRawHtml(htmlOf(block)) } }
      : block,
  ) as T[];
}

export function stripRawHtmlBlocks<T extends AnyBlock>(blocks: T[]): T[] {
  return mapTree(blocks, (block) => (block.type === 'rawHtml' ? null : block)) as T[];
}

// Applied to every block tree on its way out of a public/preview route.
export function prepareBlocksForPublic<T extends AnyBlock>(blocks: T[], rawHtmlEnabled: boolean): T[] {
  const prepared = rawHtmlEnabled ? sanitizeRawHtmlBlocks(blocks) : stripRawHtmlBlocks(blocks);
  return sanitizeRichTextBlocks(prepared);
}

export type RawHtmlWriteCheck =
  | { ok: true; blocks: BlockInstance[]; rawHtmlChanged: boolean }
  | { ok: false; status: 400 | 403; error: string };

// `existing` is the block tree currently stored (undefined on create). New or modified raw
// blocks need the feature on AND an admin; unchanged ones pass through untouched.
export function checkRawHtmlWrite(input: {
  blocks: BlockInstance[];
  existing?: BlockInstance[] | undefined;
  role: UserRole;
  enabled: boolean;
}): RawHtmlWriteCheck {
  // Order matters: the cheap permission checks run on the RAW incoming values, and sanitising (the
  // expensive step) only happens once the caller is known to be allowed to write a raw block —
  // so a non-admin can never make the server do sanitising work by sending a huge raw block.
  // Rich text blocks are cleaned for everyone, whatever their role (bounded by the block's own
  // 50,000-character schema limit).
  const cleaned = sanitizeRichTextBlocks(input.blocks as AnyBlock[]) as BlockInstance[];
  const incoming = collect(cleaned as AnyBlock[]);
  if (incoming.size === 0) return { ok: true, blocks: cleaned, rawHtmlChanged: false };

  const before = collect((input.existing ?? []) as AnyBlock[]);
  const changed = [...incoming].some(([id, html]) => before.get(id) !== html);
  // Unchanged blocks are exactly what is already stored (already sanitized when it was written).
  if (!changed) return { ok: true, blocks: cleaned, rawHtmlChanged: false };

  if (!input.enabled) {
    return {
      ok: false,
      status: 400,
      error: 'Raw HTML blocks are turned off. An admin can enable them in Settings → API.',
    };
  }
  if (!roleAtLeast(input.role, 'admin')) {
    return { ok: false, status: 403, error: 'Only an admin or owner can add or change a Raw HTML block.' };
  }
  const sanitized = sanitizeRawHtmlBlocks(cleaned as AnyBlock[]) as BlockInstance[];
  return { ok: true, blocks: sanitized, rawHtmlChanged: true };
}

// A reusable block's config is one block's config (a Rich text one carries editor HTML).
export function sanitizeReusableBlockConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRichTextBlocks([{ id: 'reusable', type, config }])[0]!.config;
}
