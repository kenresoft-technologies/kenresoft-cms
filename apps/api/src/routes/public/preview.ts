import { createRoute } from '@hono/zod-openapi';
import { entrySchema } from '@kenresoft-cms/contracts';
import type { Entry, EntryStatus } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { verifyPreviewToken } from '../../lib/preview-token';
import { getContentTypeBySlug } from '../../repositories/content-types';
import { getEntryBySlug } from '../../repositories/entries';
import type { Entry as DbEntry } from '@kenresoft-cms/database';

export const publicPreviewRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });
const previewParamSchema = z.object({ contentType: z.string().min(1), slug: z.string().min(1) });
const previewQuerySchema = z.object({ token: z.string().min(1) });

function toEntry(row: DbEntry): Entry {
  return {
    id: row.id,
    contentTypeId: row.contentTypeId,
    slug: row.slug,
    status: row.status as EntryStatus,
    data: row.data,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Deliberately never edge-cached (unlike routes/public/content.ts) — Live Preview exists
// specifically to show content that hasn't gone through the normal publish-then-invalidate
// lifecycle yet, and each token is single-entry/short-lived enough that caching would only add
// complexity for a path that's inherently low-traffic.
//
// "Entry not found" covers both a genuinely missing entry and a present-but-wrong/expired/
// missing token — the same "never distinguishable from the outside" property
// routes/public/content.ts already has for a draft vs. a nonexistent slug, extended here to
// "no valid token" vs. "no such entry." A missing *content type* still gets its own message,
// matching that same file's existing (pre-existing, unchanged-by-this-feature) asymmetry.
publicPreviewRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{contentType}/{slug}',
    tags: ['Public content'],
    summary: 'Preview a single entry (any status) with a valid, entry-scoped token',
    request: { params: previewParamSchema, query: previewQuerySchema },
    responses: {
      200: {
        description: 'The entry, regardless of draft/published status.',
        content: { 'application/json': { schema: entrySchema } },
      },
      404: {
        description: 'No content type with that slug, or no entry with that slug plus a valid token for it.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { contentType: contentTypeSlug, slug } = c.req.valid('param');
    const { token } = c.req.valid('query');
    const db = getDb(c);

    const contentType = await getContentTypeBySlug(db, contentTypeSlug);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const entry = await getEntryBySlug(db, contentType.id, slug);
    if (!entry || !(await verifyPreviewToken(c.env.BETTER_AUTH_SECRET, token, entry.id))) {
      return c.json({ error: 'Entry not found' }, 404);
    }

    return c.json(toEntry(entry), 200);
  },
);
