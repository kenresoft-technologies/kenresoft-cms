import { createRoute } from '@hono/zod-openapi';
import { entrySchema, pageSchema } from '@kenresoft-cms/contracts';
import type { Entry, EntryStatus, Page } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { loadRichTextFields, sanitizeEntryData } from '../../lib/entry-html';
import type { RichTextFieldMap } from '../../lib/entry-html';
import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { isRawHtmlEnabled, prepareBlocksForPublic } from '../../lib/raw-html-guard';
import { verifyPreviewToken } from '../../lib/preview-token';
import { getContentTypeBySlug } from '../../repositories/content-types';
import { getEntryBySlug } from '../../repositories/entries';
import { getPageByRoute } from '../../repositories/pages';
import type { Entry as DbEntry, Page as DbPage } from '@kenresoft-cms/database';

export const publicPreviewRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });
const previewParamSchema = z.object({ contentType: z.string().min(1), slug: z.string().min(1) });
const previewQuerySchema = z.object({ token: z.string().min(1) });
const pagePreviewQuerySchema = z.object({ route: z.string().min(1), token: z.string().min(1) });

function toEntry(row: DbEntry, richText: RichTextFieldMap): Entry {
  return {
    id: row.id,
    contentTypeId: row.contentTypeId,
    slug: row.slug,
    status: row.status as EntryStatus,
    data: sanitizeEntryData(richText, row.contentTypeId, row.data),
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// `rawHtmlEnabled` is read live on every request: turning the feature off hides every Raw HTML
// block immediately, and while it is on the HTML is sanitized again on the way out (the stored
// copy was already sanitized on write — this is defense in depth, and means a later sanitizer
// improvement applies retroactively).
function toPage(row: DbPage, rawHtmlEnabled: boolean): Page {
  return {
    id: row.id,
    route: row.route,
    title: row.title,
    status: row.status as EntryStatus,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    templateId: row.templateId,
    blocks: prepareBlocksForPublic(row.blocks.blocks, rawHtmlEnabled),
    seo: row.seo ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Phase 5 of the schema-driven frontend work (docs/SITE_BUILDER.md §1.3/§4.2/§20) — mirrors the
// entry preview route below exactly, reusing verifyPreviewToken() unmodified with the Page's own
// id as the expected id. Registered on this same app, at a path `/{contentType}/{slug}` below
// could never ambiguously match (a bare "/pages" is one segment, that route needs two) — but
// still declared first for the same "specific route before the more generic one" ordering
// discipline this codebase applies elsewhere (e.g. content-types.ts's field-reorder route). A
// query param (not `/pages/{route}`) for the same reason routes/public/pages.ts's own by-route
// route uses one — a route can contain slashes. Deliberately never edge-cached, same reasoning
// as entry preview below.
publicPreviewRoute.openapi(
  createRoute({
    method: 'get',
    path: '/pages',
    tags: ['Public content'],
    summary: 'Preview a single page (any status) with a valid, page-scoped token',
    request: { query: pagePreviewQuerySchema },
    responses: {
      200: {
        description: 'The page, regardless of draft/published status.',
        content: { 'application/json': { schema: pageSchema } },
      },
      404: {
        description: 'No page at that route plus a valid token for it.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { route, token } = c.req.valid('query');
    const db = getDb(c);

    const page = await getPageByRoute(db, route);
    if (!page || !(await verifyPreviewToken(c.env.BETTER_AUTH_SECRET, token, page.id))) {
      return c.json({ error: 'Page not found' }, 404);
    }

    return c.json(toPage(page, await isRawHtmlEnabled(db)), 200);
  },
);

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

    return c.json(toEntry(entry, await loadRichTextFields(db)), 200);
  },
);
