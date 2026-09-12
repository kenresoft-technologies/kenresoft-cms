import { z } from 'zod';

import { blockInstanceSchema } from './blocks';
import { ENTRY_STATUSES } from './enums';
import { pageRouteSchema } from './routing';

// Mirrors structured-settings' own `seo` module shape (§3.1) for consistency, but page-scoped —
// a per-page override of the site-wide default, not a replacement for it. `.strict()` so an
// unrecognized key 400s rather than being silently stored, same convention as
// field-definitions.ts's `fieldPresentationSchema`.
export const pageSeoSchema = z
  .object({
    title: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    ogImageMediaId: z.string().max(100).optional(),
    noindex: z.boolean().optional(),
    canonical: z.string().max(2000).optional(),
  })
  .strict();

export type PageSeo = z.infer<typeof pageSeoSchema>;

export const pageSchema = z.object({
  id: z.string(),
  route: z.string(),
  title: z.string(),
  status: z.enum(ENTRY_STATUSES),
  publishAt: z.string().nullable(),
  // Phase 4 (§3.1/§3.5): which template (if any) this page's blocks were copied from at
  // creation — bookkeeping only, never live-linked; editing the template afterward has no
  // effect on this page.
  templateId: z.string().nullable(),
  blocks: z.array(blockInstanceSchema),
  seo: pageSeoSchema.nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Page = z.infer<typeof pageSchema>;

// A Page's own list-response shape (§4.2) — id/route/title only, never the full block tree, the
// same list-vs-detail distinction routes/public/content.ts already draws between listing
// entries and fetching one.
export const pageListItemSchema = z.object({
  id: z.string(),
  route: z.string(),
  title: z.string(),
});

export type PageListItem = z.infer<typeof pageListItemSchema>;

// z.null() must come before z.coerce.date(), same reasoning as entries.ts's own
// publishAtInputSchema — coercion treats null as epoch rather than failing.
const publishAtInputSchema = z.union([z.null(), z.coerce.date()]);

export const createPageSchema = z.object({
  route: pageRouteSchema,
  title: z.string().min(1).max(200),
  status: z.enum(ENTRY_STATUSES).optional().default('draft'),
  // Phase 4: when set and `blocks` is omitted/empty, the server copies this template's own
  // blocks into the new page (routes/admin/pages.ts) — a one-time copy, not a live link.
  templateId: z.string().optional(),
  blocks: z.array(blockInstanceSchema).optional().default([]),
  seo: pageSeoSchema.nullable().optional(),
  publishAt: publishAtInputSchema.optional(),
});

export const updatePageSchema = z.object({
  route: pageRouteSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  blocks: z.array(blockInstanceSchema).optional(),
  seo: pageSeoSchema.nullable().optional(),
  publishAt: publishAtInputSchema.optional(),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
