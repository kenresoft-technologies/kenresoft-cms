import type { Database, Media, MediaVisibility } from '@kenresoft-cms/database';

import { sniffAttachment } from './attachment-metadata';
import { sniffImage } from './image-metadata';
import { invalidatePublicMediaCache } from './public-cache';
import { createMedia, deleteMedia, getMediaById } from '../repositories/media';
import { countAttachmentsForMedia } from '../repositories/media-attachments';

// Extracted (behavior-preserving) from routes/admin/media.ts so this exact upload/delete code
// path can be reused by @kenresoft-cms/plugin-sdk's MediaService (apps/api/src/plugins/
// context.ts) — a plugin never touches R2 or the media table directly, only this. Existing
// callers (routes/admin/media.ts) verified unchanged against apps/api/test/media-routes.test.ts.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadMediaInput {
  bytes: Uint8Array;
  filename: string;
  altText: string | null;
  folderId?: string | null;
  // 'public' (default, and the only option before Phase 5) accepts only the existing image
  // types — the public image contract (MEDIA_CONTENT_TYPES) is never widened. 'private'
  // additionally accepts documents (PDF/DOCX) via sniffAttachment's existing byte-level
  // validation — never a client-declared MIME type — since only a private asset may ever be a
  // document (§9/Phase 5's content-type decision).
  visibility?: MediaVisibility;
}

export type UploadMediaResult = { ok: true; media: Media } | { ok: false; error: string };

interface Sniffed {
  contentType: string;
  width: number | null;
  height: number | null;
  extension: string;
}

function sniffForVisibility(bytes: Uint8Array, visibility: MediaVisibility): Sniffed | null {
  if (visibility === 'public') {
    const image = sniffImage(bytes);
    return image ? { ...image, extension: image.contentType.split('/')[1]! } : null;
  }

  // Private: images or documents, via the same byte-level sniffer forms' file-field validation
  // already uses. sniffAttachment doesn't itself report image dimensions, so a private image
  // still gets a real width/height by re-checking it against sniffImage — a no-op (null/null)
  // for an actual document.
  const attachment = sniffAttachment(bytes);
  if (!attachment) return null;
  const image = sniffImage(bytes);
  return {
    contentType: attachment.contentType,
    width: image?.width ?? null,
    height: image?.height ?? null,
    extension: attachment.extension,
  };
}

export async function uploadMedia(
  db: Database,
  bucket: R2Bucket,
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` };
  }

  const visibility = input.visibility ?? 'public';
  // The declared Content-Type (client/browser-supplied) is never trusted (§9) — only the file's
  // actual bytes decide what it is and whether it's accepted at all.
  const sniffed = sniffForVisibility(input.bytes, visibility);
  if (!sniffed) {
    return {
      ok: false,
      error: visibility === 'private' ? 'Unsupported or unrecognized file' : 'Unsupported or unrecognized image file',
    };
  }

  const key = `media/${crypto.randomUUID()}.${sniffed.extension}`;
  await bucket.put(key, input.bytes, { httpMetadata: { contentType: sniffed.contentType } });

  const row = await createMedia(db, {
    key,
    filename: input.filename || key,
    contentType: sniffed.contentType as Media['contentType'],
    size: input.bytes.byteLength,
    width: sniffed.width,
    height: sniffed.height,
    altText: input.altText,
    folderId: input.folderId ?? null,
    visibility,
  });

  return { ok: true, media: row };
}

export function getMedia(db: Database, id: string): Promise<Media | undefined> {
  return getMediaById(db, id);
}

// Returns the deleted row (for callers that still need it for an audit-log entry or similar),
// or null if there was nothing with that id to delete.
export async function deleteMediaFile(db: Database, bucket: R2Bucket, id: string): Promise<Media | null> {
  const row = await getMediaById(db, id);
  if (!row) {
    return null;
  }

  await bucket.delete(row.key);
  await deleteMedia(db, row.id);
  // Without this, a deleted file would keep being served from the public route's edge cache for
  // up to a year (lib/public-cache.ts's media TTL).
  await invalidatePublicMediaCache(row.id);

  return row;
}

export type DeleteIfUnreferencedResult = 'deleted' | 'kept' | 'not_found';

// Used when removing one owner's *relationship* to a Media asset (e.g. a form submission being
// deleted) — the relationship itself is always removed by the caller first, but the underlying
// Media/R2 object is only physically deleted once no other media_attachments row still points
// at it. Never used by the admin Media Library's own direct "delete this item" action, which is
// an explicit, unconditional delete regardless of references (Phase 5's deletion-behavior
// decision distinguishes "remove a relationship" from "delete the asset outright").
export async function deleteMediaIfUnreferenced(
  db: Database,
  bucket: R2Bucket,
  mediaId: string,
): Promise<DeleteIfUnreferencedResult> {
  const remaining = await countAttachmentsForMedia(db, mediaId);
  if (remaining.length > 0) {
    return 'kept';
  }
  const deleted = await deleteMediaFile(db, bucket, mediaId);
  return deleted ? 'deleted' : 'not_found';
}
