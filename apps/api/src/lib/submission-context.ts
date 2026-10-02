import type { Database, Entry, Form, FormSubmission } from '@kenresoft-cms/database';
import type { SubmissionContext } from '@kenresoft-cms/contracts';

import { getContentTypeBySlug } from '../repositories/content-types';
import { getPublishedEntryBySlug } from '../repositories/entries';

// Submission context (forms.contextConfig): a form that is always about one published entry.
// The visitor only says WHICH entry by slug (?context=<slug>); everything stored comes from the
// entry the server resolved, so the stored reference can't be forged into a different record,
// and a draft, unpublished or closed entry refuses the submission however the request got here.

export interface SubmissionContextSnapshot {
  contentType: string;
  slug: string;
  title: string;
}

export type ResolvedSubmissionContext =
  | { ok: true; entryId: string; snapshot: SubmissionContextSnapshot }
  | { ok: false; status: 400 | 404 | 409; error: string };

function entryTitle(entry: Pick<Entry, 'slug' | 'data'>): string {
  for (const key of ['title', 'name']) {
    const value = entry.data[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  }
  return entry.slug;
}

// True while the entry may take submissions: every openWhen field equals its value, and a
// deadline date (if configured and set) has not passed. A field the entry has no value for
// counts as not matching, so a misconfigured gate fails closed.
export function isEntryOpen(
  config: NonNullable<Form['contextConfig']>,
  data: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  for (const rule of config.openWhen ?? []) {
    if (data[rule.field] !== rule.equals) return false;
  }
  if (config.deadlineField) {
    const raw = data[config.deadlineField];
    if (typeof raw === 'string' && raw) {
      // A bare date (YYYY-MM-DD) stays open for that whole day (UTC).
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59.999Z`) : new Date(raw);
      if (!Number.isNaN(deadline.getTime()) && deadline.getTime() < now.getTime()) return false;
    }
  }
  return true;
}

// null when the form has no context; otherwise the resolved entry or why it was refused.
export async function resolveSubmissionContext(
  db: Database,
  form: Pick<Form, 'contextConfig'>,
  slug: string | undefined,
): Promise<ResolvedSubmissionContext | null> {
  const config = form.contextConfig;
  if (!config) return null;
  if (!slug) return { ok: false, status: 400, error: 'This form must be submitted for a specific item' };
  const contentType = await getContentTypeBySlug(db, config.contentType);
  const entry = contentType ? await getPublishedEntryBySlug(db, contentType.id, slug) : undefined;
  if (!entry) return { ok: false, status: 404, error: 'Not found' };
  if (!isEntryOpen(config, entry.data)) {
    return { ok: false, status: 409, error: 'This is no longer accepting submissions' };
  }
  return {
    ok: true,
    entryId: entry.id,
    snapshot: { contentType: config.contentType, slug: entry.slug, title: entryTitle(entry) },
  };
}

export function toSubmissionContext(
  row: Pick<FormSubmission, 'context' | 'contextEntryId'>,
): SubmissionContext | null {
  return row.context ? { ...row.context, entryId: row.contextEntryId ?? null } : null;
}
