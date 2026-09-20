import type { Context } from 'hono';
import type { ZodType } from 'zod';

import { sanitizeReplyHtml } from '../html-sanitizer';
import { htmlToPlainText, stripTags } from '../html-to-text';
import { sanitizeEmailHtml } from '../raw-html-sanitizer';
import type { EmailMessage } from './types';

export interface ComposeRequest<T> {
  fields: T;
  files: File[];
  mediaIds: string[];
}

export type ParseComposeResult<T> = { ok: true; value: ComposeRequest<T> } | { ok: false; error: string };

// One request shape for every admin-composed email (the Email page and submission replies):
// multipart/form-data with the text fields, any number of `files`, and any number of `mediaIds`
// (Media Library items, read server-side). Plain JSON is still accepted for attachment-less
// callers. Text fields are validated with the caller's own Zod schema.
export async function parseComposeRequest<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<ParseComposeResult<T>> {
  const contentType = c.req.header('content-type') ?? '';
  let raw: Record<string, unknown> = {};
  let files: File[] = [];
  let mediaIds: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return { ok: false, error: 'Invalid multipart body' };
    }
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string' && key !== 'mediaIds') raw[key] = value;
    }
    files = form.getAll('files').filter((v): v is File => typeof v !== 'string');
    mediaIds = form.getAll('mediaIds').filter((v): v is string => typeof v === 'string');
  } else {
    try {
      raw = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'Invalid JSON body' };
    }
    if (Array.isArray(raw['mediaIds'])) {
      mediaIds = (raw['mediaIds'] as unknown[]).filter((v): v is string => typeof v === 'string');
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed' };
  }
  return { ok: true, value: { fields: parsed.data, files, mediaIds } };
}

// The authored HTML is sanitized (strict allow-list) and sent as the real HTML body, with a
// plain-text alternative derived from it.
export function buildBodies(bodyHtml: string): Pick<EmailMessage, 'html' | 'text'> & { html: string } {
  const html = sanitizeReplyHtml(bodyHtml);
  return { html, text: htmlToPlainText(html) };
}

// Plain-text alternative for a designed email: table cells are separated (so columns don't run
// together) and link targets are kept, since a plain-text reader can't click a button.
function designHtmlToPlainText(html: string): string {
  const withLinks = html.replace(
    /<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const text = stripTags(label).trim();
      return text && text !== href ? `${text} (${href})` : href;
    },
  );
  return htmlToPlainText(withLinks.replace(/<\/(td|th)>/gi, ' ').replace(/<\/(table|tr)>/gi, '\n'));
}

// 'Design HTML' mode: the layout is preserved, but only after the email-specific sanitizer (no
// scripts, forms, iframes, event handlers, unsafe/relative URLs, data: images or positioning).
export function buildDesignBodies(bodyHtml: string): { html: string; text: string } {
  const html = sanitizeEmailHtml(bodyHtml);
  return { html, text: designHtmlToPlainText(html) };
}
