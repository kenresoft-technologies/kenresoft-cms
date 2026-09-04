import type { Database, Media } from '@kenresoft-cms/database';

import { sniffImage } from './image-metadata';
import { invalidatePublicMediaCache } from './public-cache';
import { createMedia, deleteMedia, getMediaById } from '../repositories/media';

// Extracted (behavior-preserving) from routes/admin/media.ts so this exact upload/delete code
// path can be reused by @kenresoft-cms/plugin-sdk's MediaService (apps/api/src/plugins/
// context.ts) — a plugin never touches R2 or the media table directly, only this. Existing
// callers (routes/admin/media.ts) verified unchanged against apps/api/test/media-routes.test.ts.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadMediaInput {
  bytes: Uint8Array;
  filename: string;
  altText: string | null;
}

export type UploadMediaResult = { ok: true; media: Media } | { ok: false; error: string };

export async function uploadMedia(
  db: Database,
  bucket: R2Bucket,
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` };
  }

  // The declared Content-Type (client/browser-supplied) is never trusted (§9) — only the file's
  // actual bytes decide what it is and whether it's accepted at all.
  const sniffed = sniffImage(input.bytes);
  if (!sniffed) {
    return { ok: false, error: 'Unsupported or unrecognized image file' };
  }

  const extension = sniffed.contentType.split('/')[1]!;
  const key = `media/${crypto.randomUUID()}.${extension}`;
  await bucket.put(key, input.bytes, { httpMetadata: { contentType: sniffed.contentType } });

  const row = await createMedia(db, {
    key,
    filename: input.filename || key,
    contentType: sniffed.contentType,
    size: input.bytes.byteLength,
    width: sniffed.width,
    height: sniffed.height,
    altText: input.altText,
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
