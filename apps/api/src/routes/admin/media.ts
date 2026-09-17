import { createRoute, z } from '@hono/zod-openapi';
import { altTextSchema, MEDIA_CONTENT_TYPES, MEDIA_VISIBILITIES, mediaSchema, moveMediaSchema, updateMediaSchema } from '@kenresoft-cms/contracts';
import type { Media, MediaVisibility } from '@kenresoft-cms/contracts';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { deleteMediaFile, uploadMedia } from '../../lib/media-service';
import { invalidatePublicMediaFolderCache } from '../../lib/public-cache';
import { requireRole } from '../../middleware/require-role';
import { getMediaFolderById } from '../../repositories/media-folders';
import { getMediaById, listMedia, moveMediaToFolder, updateMedia } from '../../repositories/media';
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
    visibility: row.visibility,
    folderId: row.folderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

mediaRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Media'],
    summary: 'List media items, optionally scoped to a folder',
    request: {
      query: z.object({
        // Omitted = every item regardless of folder (the default library view). "unfiled" =
        // only items with no folder. Any other value = only that folder's items.
        folderId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Matching media items, newest first.',
        content: { 'application/json': { schema: z.array(mediaSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const { folderId } = c.req.valid('query');
    const scope = folderId === undefined ? undefined : folderId === 'unfiled' ? null : folderId;
    return c.json((await listMedia(db, scope)).map(toMedia), 200);
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

  const db = getDb(c);
  const folderIdRaw = form.get('folderId');
  let folderId: string | null = null;
  let uploadFolder = null;
  if (typeof folderIdRaw === 'string' && folderIdRaw.length > 0) {
    uploadFolder = await getMediaFolderById(db, folderIdRaw);
    if (!uploadFolder) {
      return c.json({ error: 'No media folder with that id' }, 400);
    }
    folderId = folderIdRaw;
  }

  const visibilityRaw = form.get('visibility');
  let visibility: MediaVisibility = 'public';
  if (typeof visibilityRaw === 'string' && visibilityRaw.length > 0) {
    if (!(MEDIA_VISIBILITIES as readonly string[]).includes(visibilityRaw)) {
      return c.json({ error: 'visibility must be "public" or "private"' }, 400);
    }
    visibility = visibilityRaw as MediaVisibility;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadMedia(db, c.env.MEDIA_BUCKET, {
    bytes,
    filename: file.name,
    altText: altTextParsed.data ?? null,
    folderId,
    visibility,
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
  if (uploadFolder) await invalidatePublicMediaFolderCache(uploadFolder.slug);

  return c.json(toMedia(row), 201);
});

mediaRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/',
  tags: ['Media'],
  summary: 'Upload a media file',
  description:
    'multipart/form-data with a `file` field (required), an `altText` field (optional), and a ' +
    '`visibility` field (optional, "public" or "private" — defaults to "public"; only a ' +
    '"private" asset may be a document rather than an image). The file is accepted or rejected ' +
    'by sniffing its actual bytes, not its declared MIME type.',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string().openapi({ type: 'string', format: 'binary' }),
            altText: z.string().optional(),
            visibility: z.string().optional(),
          }),
        },
      },
    },
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
    method: 'patch',
    path: '/{id}',
    tags: ['Media'],
    summary: 'Rename a media item or update its alt text',
    description: 'Never touches the file bytes, R2 key, or content type — those are immutable once uploaded (§14).',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateMediaSchema } } },
    },
    responses: {
      200: {
        description: 'The updated media item.',
        content: { 'application/json': { schema: mediaSchema } },
      },
      400: {
        description: 'A document-content-type asset cannot be made public.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No media with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);

    if (input.visibility === 'public') {
      const existing = await getMediaById(db, id);
      if (!existing) {
        return c.json({ error: 'Media not found' }, 404);
      }
      if (!(MEDIA_CONTENT_TYPES as readonly string[]).includes(existing.contentType)) {
        return c.json({ error: 'A document asset cannot be made public — the public Media contract only allows images' }, 400);
      }
    }

    const row = await updateMedia(db, id, input);
    if (!row) {
      return c.json({ error: 'Media not found' }, 404);
    }

    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'media.updated',
      targetType: 'media',
      targetId: row.id,
      metadata: { filename: row.filename },
    });
    if (row.folderId) {
      const folder = await getMediaFolderById(db, row.folderId);
      if (folder) await invalidatePublicMediaFolderCache(folder.slug);
    }

    return c.json(toMedia(row), 200);
  },
);

mediaRoute.openapi(
  createRoute({
    method: 'post',
    path: '/move',
    tags: ['Media'],
    summary: 'Move one or more media items into a folder (or back to unfiled)',
    middleware: requireRole('admin', 'editor'),
    request: {
      body: { content: { 'application/json': { schema: moveMediaSchema } } },
    },
    responses: {
      200: {
        description: 'How many media items were moved.',
        content: { 'application/json': { schema: z.object({ moved: z.number().int() }) } },
      },
      400: {
        description: 'folderId does not reference a real media folder.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { mediaIds, folderId } = c.req.valid('json');
    const db = getDb(c);

    let targetFolder = null;
    if (folderId !== null) {
      targetFolder = await getMediaFolderById(db, folderId);
      if (!targetFolder) {
        return c.json({ error: 'No media folder with that id' }, 400);
      }
    }

    // Every source folder touched needs its public listing cache invalidated too, not just the
    // destination — fetched before the move so the "previous" folder is still known afterward.
    const before = await Promise.all(mediaIds.map((id) => getMediaById(db, id)));
    const sourceFolderIds = new Set(before.filter((row) => row?.folderId).map((row) => row!.folderId!));

    const moved = await moveMediaToFolder(db, mediaIds, folderId);

    const sourceFolders = await Promise.all(Array.from(sourceFolderIds).map((id) => getMediaFolderById(db, id)));
    await Promise.all(
      [...sourceFolders.filter((f) => f !== undefined), targetFolder].filter((f) => f !== null && f !== undefined).map((f) => invalidatePublicMediaFolderCache(f!.slug)),
    );

    return c.json({ moved }, 200);
  },
);

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
    if (row.folderId) {
      const folder = await getMediaFolderById(db, row.folderId);
      if (folder) await invalidatePublicMediaFolderCache(folder.slug);
    }

    return c.body(null, 204);
  },
);
