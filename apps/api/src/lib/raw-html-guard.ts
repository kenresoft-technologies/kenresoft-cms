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

export function stripRawHtmlBlocks<T extends AnyBlock>(blocks: T[]): T[] {
  return mapTree(blocks, (block) => (block.type === 'rawHtml' ? null : block)) as T[];
}

// Applied to every block tree on its way out of a public/preview route.
export function prepareBlocksForPublic<T extends AnyBlock>(blocks: T[], rawHtmlEnabled: boolean): T[] {
  return rawHtmlEnabled ? sanitizeRawHtmlBlocks(blocks) : stripRawHtmlBlocks(blocks);
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
  const sanitized = sanitizeRawHtmlBlocks(input.blocks as AnyBlock[]) as BlockInstance[];
  const incoming = collect(sanitized as AnyBlock[]);
  if (incoming.size === 0) return { ok: true, blocks: sanitized, rawHtmlChanged: false };

  const before = collect((input.existing ?? []) as AnyBlock[]);
  const changed = [...incoming].some(([id, html]) => before.get(id) !== html);
  if (!changed) return { ok: true, blocks: sanitized, rawHtmlChanged: false };

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
  return { ok: true, blocks: sanitized, rawHtmlChanged: true };
}
