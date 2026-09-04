import { createRoute, z } from '@hono/zod-openapi';
import { altTextSchema, mediaSchema } from '@kenresoft-cms/contracts';
import type { Media } from '@kenresoft-cms/contracts';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { deleteMediaFile, uploadMedia } from '../../lib/media-service';
import { requireRole } from '../../middleware/require-role';
import { getMediaById, listMedia } from '../../repositories/media';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Media as DbMedia } from '@kenresoft-cms/database';

export const mediaRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });

function toMedia(row: DbMedia): Media {
  return {
    id: row.id,
    key: row.key,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    width: row.width,
    height: row.height,
    altText: row.altText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

mediaRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Media'],
    summary: 'List every media item',
    responses: {
      200: {
        description: 'Every media item, newest first.',
        content: { 'application/json': { schema: z.array(mediaSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listMedia(db)).map(toMedia), 200);
  },
);

// Multipart upload — validates the file's actual bytes via magic-number sniffing rather than
// a declared Content-Type, so it doesn't fit a static Zod request-body schema and stays a
// plain (non-.openapi()) route. Registered with the registry directly below purely so it
// still shows up in the generated doc, since a plain route otherwise wouldn't.
// author/viewer can't manage media (§10) — everyone else (admin/editor) can.
mediaRoute.post('/', requireRole('admin', 'editor'), async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json({ error: 'Expected multipart/form-data' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'file field is required' }, 400);
  }

  const altTextRaw = form.get('altText');
  const altTextParsed = altTextSchema.safeParse(
    typeof altTextRaw === 'string' && altTextRaw.length > 0 ? altTextRaw : undefined,
  );
  if (!altTextParsed.success) {
    return c.json({ error: 'Validation failed', issues: altTextParsed.error.issues }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const db = getDb(c);
  const result = await uploadMedia(db, c.env.MEDIA_BUCKET, {
    bytes,
    filename: file.name,
    altText: altTextParsed.data ?? null,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  const row = result.media;
  await recordAudit(db, {
    actorUserId: c.get('user').id,
    action: 'media.uploaded',
    targetType: 'media',
    targetId: row.id,
    metadata: { filename: row.filename, contentType: row.contentType, size: row.size },
  });

  return c.json(toMedia(row), 201);
});

mediaRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/',
  tags: ['Media'],
  summary: 'Upload a media file',
  description:
    'multipart/form-data with a `file` field (required) and an `altText` field (optional). ' +
    'The file is accepted or rejected by sniffing its actual bytes, not its declared MIME type.',
  request: {
    body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ type: 'string', format: 'binary' }), altText: z.string().optional() }) } } },
  },
  responses: {
    201: {
      description: 'The created media item.',
      content: { 'application/json': { schema: mediaSchema } },
    },
    400: {
      description: 'Missing/oversized file, or an unrecognized image format.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
  },
});

// Streams the raw image bytes — not a JSON response, so this stays a plain route too (with a
// docs-only registerPath below for the same reason as the upload route above).
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

mediaRoute.openAPIRegistry.registerPath({
  method: 'get',
  path: '/{id}/file',
  tags: ['Media'],
  summary: 'Download a media file',
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'The raw file bytes.',
      content: { 'image/png': {}, 'image/jpeg': {}, 'image/gif': {}, 'image/webp': {} },
    },
    404: {
      description: 'No media with that id, or the file is missing from storage.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
  },
});

mediaRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Media'],
    summary: 'Delete a media item',
    middleware: requireRole('admin', 'editor'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The media item was deleted.' },
      404: {
        description: 'No media with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const row = await deleteMediaFile(db, c.env.MEDIA_BUCKET, id);
    if (!row) {
      return c.json({ error: 'Media not found' }, 404);
    }

    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'media.deleted',
      targetType: 'media',
      targetId: row.id,
      metadata: { filename: row.filename },
    });

    return c.body(null, 204);
  },
);
