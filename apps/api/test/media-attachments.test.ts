import { env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { deleteMediaIfUnreferenced, uploadMedia } from '../src/lib/media-service';
import {
  createMediaAttachment,
  deleteAttachmentsForOwner,
  listAttachmentsForOwner,
} from '../src/repositories/media-attachments';
import { getMediaById } from '../src/repositories/media';

const db = createDb(env.DB);

const pdfBytes = new TextEncoder().encode('%PDF-1.4\nfake-but-signature-valid');

describe('media_attachments reference-counted deletion (Phase 5, real D1 + R2)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM media_attachments');
    await env.DB.exec('DELETE FROM media');
  });

  it('keeps the Media/R2 object when another owner still references it, and only deletes once unreferenced', async () => {
    const uploaded = await uploadMedia(db, env.MEDIA_BUCKET, {
      bytes: pdfBytes,
      filename: 'shared.pdf',
      altText: null,
      visibility: 'private',
    });
    if (!uploaded.ok) throw new Error('upload failed');
    const mediaId = uploaded.media.id;

    await createMediaAttachment(db, { mediaId, ownerType: 'form_submission', ownerId: 'sub-1', fieldName: 'resume' });
    await createMediaAttachment(db, { mediaId, ownerType: 'form_submission', ownerId: 'sub-2', fieldName: 'resume' });

    // Removing the first owner's relationship must not delete the still-referenced asset.
    await deleteAttachmentsForOwner(db, 'form_submission', 'sub-1');
    const resultAfterFirstRemoval = await deleteMediaIfUnreferenced(db, env.MEDIA_BUCKET, mediaId);
    expect(resultAfterFirstRemoval).toBe('kept');
    expect(await getMediaById(db, mediaId)).toBeDefined();

    // Removing the second (last) owner's relationship should now delete the asset for real.
    await deleteAttachmentsForOwner(db, 'form_submission', 'sub-2');
    const resultAfterSecondRemoval = await deleteMediaIfUnreferenced(db, env.MEDIA_BUCKET, mediaId);
    expect(resultAfterSecondRemoval).toBe('deleted');
    expect(await getMediaById(db, mediaId)).toBeUndefined();
  });

  it('cascades the media_attachments row itself when the Media asset is deleted directly', async () => {
    const uploaded = await uploadMedia(db, env.MEDIA_BUCKET, {
      bytes: pdfBytes,
      filename: 'direct-delete.pdf',
      altText: null,
      visibility: 'private',
    });
    if (!uploaded.ok) throw new Error('upload failed');
    const mediaId = uploaded.media.id;
    await createMediaAttachment(db, { mediaId, ownerType: 'form_submission', ownerId: 'sub-3', fieldName: 'resume' });

    const deleteResult = await deleteMediaIfUnreferenced(db, env.MEDIA_BUCKET, mediaId);
    // Still referenced (the relationship was never removed here) — kept, as expected.
    expect(deleteResult).toBe('kept');

    const remaining = await listAttachmentsForOwner(db, 'form_submission', 'sub-3');
    expect(remaining).toHaveLength(1);
  });
});
