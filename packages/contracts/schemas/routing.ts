import { z } from 'zod';

import { RESERVED_ROUTE_PREFIXES } from './enums';

// Phase 2 of the schema-driven frontend work (docs/SITE_BUILDER.md §14 decision #2, resolved):
// v1 route patterns support EXACTLY one required "{slug}" parameter and nothing richer —
// no multiple parameters, no optional segments, no wildcards, no regex, no localization
// segments. `{slug}` must be the pattern's final segment (so "no trailing slash except a bare
// root" is satisfied by construction: a pattern always ends in the literal text "{slug}",
// never a "/"). Every other segment is a plain lowercase-alphanumeric-and-hyphen literal —
// the same character set `slugSchema` (./common.ts) already allows for a real entry slug.
const ROUTE_PATTERN_SHAPE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*\{slug\}$/;

export function firstRouteSegment(pathOrPattern: string): string | undefined {
  return pathOrPattern.split('/').find((segment) => segment.length > 0);
}

export function isReservedRouteSegment(segment: string): boolean {
  return (RESERVED_ROUTE_PREFIXES as readonly string[]).includes(segment);
}

// Kept separate from the Zod schema below so the API layer's collision-checking code (which
// needs to test reserved-ness independent of full pattern validity — e.g. when validating a
// future Pages `route`, which has no "{slug}" requirement at all) can reuse it directly.
export function isReservedRoutePattern(pattern: string): boolean {
  const first = firstRouteSegment(pattern);
  return first !== undefined && isReservedRouteSegment(first);
}

export const routePatternSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => ROUTE_PATTERN_SHAPE.test(value), {
    message:
      'Route pattern must start with "/", use only lowercase alphanumeric-and-hyphen literal segments, and end with exactly one "{slug}" parameter — e.g. "/blog/{slug}".',
  })
  .refine((value) => !isReservedRoutePattern(value), {
    message: 'Route pattern starts with a reserved path segment.',
  });

export type RoutePattern = z.infer<typeof routePatternSchema>;
