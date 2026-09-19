import { eq, fieldDefinitions } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

import { sanitizeRawHtml } from './raw-html-sanitizer';

// `rich_text` entry fields hold editor-authored HTML that public sites render directly and the
// admin's own Preview renders too. Any role that can write entries can write it, so it is
// sanitised on every write and again on every read (admin and public) — never trusted as stored.
// Only string values of fields whose type is rich_text are touched; everything else passes through.
export type RichTextFieldMap = Map<string, string[]>;

export async function loadRichTextFields(db: Database): Promise<RichTextFieldMap> {
  const rows = await db
    .select({ contentTypeId: fieldDefinitions.contentTypeId, name: fieldDefinitions.name })
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.fieldType, 'rich_text'));
  const map: RichTextFieldMap = new Map();
  for (const row of rows) map.set(row.contentTypeId, [...(map.get(row.contentTypeId) ?? []), row.name]);
  return map;
}

export function sanitizeEntryData<T extends Record<string, unknown>>(
  map: RichTextFieldMap,
  contentTypeId: string,
  data: T,
): T {
  const names = map.get(contentTypeId);
  if (!names || names.length === 0) return data;
  const next: Record<string, unknown> = { ...data };
  for (const name of names) {
    const value = next[name];
    if (typeof value === 'string') next[name] = sanitizeRawHtml(value);
  }
  return next as T;
}

export async function sanitizeEntryDataForType<T extends Record<string, unknown>>(
  db: Database,
  contentTypeId: string,
  data: T,
): Promise<T> {
  return sanitizeEntryData(await loadRichTextFields(db), contentTypeId, data);
}
