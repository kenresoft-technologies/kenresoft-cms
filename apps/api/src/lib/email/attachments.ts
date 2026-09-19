import { getMediaById } from '../../repositories/media';
import { sniffAttachment } from '../attachment-metadata';
import type { Database } from '@kenresoft-cms/database';
import type { Bindings } from '../env';
import type { EmailAttachment } from './types';

// Attachment limits enforced by the CMS before anything reaches a provider, so a too-large
// message fails with a clear 400 instead of an opaque provider error. Sizes are raw bytes summed
// across attachments; MIME/base64 inflates them ~1.37x. Provider message limits (checked against
// their docs):
//  - Cloudflare Email Service: 5 MiB per message including attachments by default (25 MiB only
//    for verified destination addresses, which the CMS can't assume) -> 3 MB raw leaves room
//    for encoding overhead and the body.
//  - Resend: 40 MB per email after base64 -> ~29 MB raw at most; capped at 15 MB raw because the
//    whole message is buffered in Worker memory (128 MB) while being base64-encoded.
export interface AttachmentLimits {
  maxTotalBytes: number;
  maxFiles: number;
}

const MB = 1024 * 1024;

export function getAttachmentLimits(env: Bindings): AttachmentLimits {
  return env.EMAIL_PROVIDER === 'resend'
    ? { maxTotalBytes: 15 * MB, maxFiles: 10 }
    : { maxTotalBytes: 3 * MB, maxFiles: 10 };
}

// What's recorded in the reply log — never the binary.
export function describeAttachments(attachments: EmailAttachment[]) {
  return attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    size: a.content.byteLength,
    source: a.mediaId ? ('media' as const) : ('upload' as const),
    ...(a.mediaId ? { mediaId: a.mediaId } : {}),
  }));
}

// Strips path separators, quotes and control characters so a filename can never inject a header
// or escape into a path; keeps it readable otherwise.
function safeFilename(raw: string, fallback: string): string {
  let cleaned = '';
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127 || '\\/"<>:*?|'.includes(char)) {
      cleaned += code < 32 || code === 127 ? '' : '_';
    } else {
      cleaned += char;
    }
  }
  cleaned = cleaned.trim().slice(0, 150);
  return cleaned || fallback;
}

function overLimitMessage(total: number, limits: AttachmentLimits) {
  return `Attachments total ${(total / MB).toFixed(1)} MB; this email provider allows at most ${limits.maxTotalBytes / MB} MB`;
}

export type CollectResult = { ok: true; attachments: EmailAttachment[] } | { ok: false; error: string };

// Uploaded files are accepted or rejected by their real bytes (sniffAttachment: PDF, DOCX,
// PNG/JPEG/GIF/WebP), never the client-declared type or extension. Media selections are read
// server-side from R2 with the caller's already-authenticated session — nothing is made public,
// and the file never leaves the server except as the email attachment.
export async function collectAttachments(
  env: Bindings,
  db: Database,
  input: { files: File[]; mediaIds: string[] },
): Promise<CollectResult> {
  const limits = getAttachmentLimits(env);
  const mediaIds = [...new Set(input.mediaIds)];
  if (input.files.length + mediaIds.length > limits.maxFiles) {
    return { ok: false, error: `At most ${limits.maxFiles} attachments per email` };
  }

  const attachments: EmailAttachment[] = [];
  let total = 0;

  for (const file of input.files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { ok: false, error: `"${file.name}" is empty` };
    }
    const sniffed = sniffAttachment(bytes);
    if (!sniffed) {
      return { ok: false, error: `"${file.name}" is not a supported attachment (PDF, DOCX or image)` };
    }
    total += bytes.byteLength;
    attachments.push({
      filename: safeFilename(file.name, `attachment.${sniffed.extension}`),
      contentType: sniffed.contentType,
      content: bytes,
    });
  }

  for (const id of mediaIds) {
    const row = await getMediaById(db, id);
    if (!row) {
      return { ok: false, error: 'A selected media file no longer exists' };
    }
    // Reject on the recorded size before pulling the object into memory at all.
    if (total + row.size > limits.maxTotalBytes) {
      return { ok: false, error: overLimitMessage(total + row.size, limits) };
    }
    const object = await env.MEDIA_BUCKET.get(row.key);
    if (!object) {
      return { ok: false, error: `"${row.filename}" is missing from storage` };
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    total += bytes.byteLength;
    attachments.push({
      filename: safeFilename(row.filename, 'attachment'),
      contentType: row.contentType,
      content: bytes,
      mediaId: row.id,
    });
  }

  if (total > limits.maxTotalBytes) {
    return { ok: false, error: overLimitMessage(total, limits) };
  }
  return { ok: true, attachments };
}
