import { z } from 'zod';

import { routePatternSchema } from './routing';

// The public, narrow response shape for GET /api/v1/public/route-patterns (Phase 2, docs/
// SITE_BUILDER.md) — deliberately just {contentTypeSlug, routePattern} pairs, nothing else.
// This is NOT the "public content-type metadata" endpoint docs/ASTRO.md's Known limitations
// flags as a deliberately unresolved product decision — that gap is about a content type's
// FIELD DEFINITIONS (which would reveal internal content-modeling structure); a route pattern
// reveals only a URL shape a visitor could already discover by requesting the page, so
// exposing it publicly is a much narrower disclosure and is exactly what a frontend route
// resolver (@kenresoft-cms/astro's `resolveRoute()`) needs to function without a developer
// hardcoding every content type's route by hand.
export const routePatternEntrySchema = z.object({
  contentTypeSlug: z.string(),
  routePattern: routePatternSchema,
});

export const routePatternsListSchema = z.array(routePatternEntrySchema);

export type RoutePatternEntry = z.infer<typeof routePatternEntrySchema>;
