import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { sniffImage } from '../../lib/image-metadata';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { createMedia, deleteMedia, getMediaById, listMedia } from '../../repositories/media';
import { altTextSchema } from '../../validators/media';

export const mediaRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

// §14: reasonable upload ceiling for a corporate-site media library, not a hard platform
// limit — revisit if a client's use case needs larger files.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

mediaRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await listMedia(db));
});

mediaRoute.post('/', async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json({ error: 'Expected multipart/form-data' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'file field is required' }, 400);
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` }, 400);
  }

  const altTextRaw = form.get('altText');
  const altTextParsed = altTextSchema.safeParse(
    typeof altTextRaw === 'string' && altTextRaw.length > 0 ? altTextRaw : undefined,
  );
  if (!altTextParsed.success) {
    return c.json({ error: 'Validation failed', issues: altTextParsed.error.issues }, 400);
  }

  // The declared Content-Type (client/browser-supplied) is never trusted (§9) — only the
  // file's actual bytes decide what it is and whether it's accepted at all.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    return c.json({ error: 'Unsupported or unrecognized image file' }, 400);
  }

  const extension = sniffed.contentType.split('/')[1]!;
  const key = `media/${crypto.randomUUID()}.${extension}`;
  await c.env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: sniffed.contentType },
  });

  const db = getDb(c);
  const row = await createMedia(db, {
    key,
    filename: file.name || key,
    contentType: sniffed.contentType,
    size: bytes.byteLength,
    width: sniffed.width,
    height: sniffed.height,
    altText: altTextParsed.data ?? null,
  });

  return c.json(row, 201);
});

mediaRoute.get('/:id/file', async (c) => {
  const db = getDb(c);
  const row = await getMediaById(db, c.req.param('id'));
  if (!row) {
    return c.json({ error: 'Media not found' }, 404);
  }

  const object = await c.env.MEDIA_BUCKET.get(row.key);
  if (!object) {
    return c.json({ error: 'Media file missing from storage' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': row.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

mediaRoute.delete('/:id', async (c) => {
  const db = getDb(c);
  const row = await getMediaById(db, c.req.param('id'));
  if (!row) {
    return c.json({ error: 'Media not found' }, 404);
  }

  await c.env.MEDIA_BUCKET.delete(row.key);
  await deleteMedia(db, row.id);

  return c.body(null, 204);
});
