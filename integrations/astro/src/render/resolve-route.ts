// Dynamic content routing — Phase 2 of the schema-driven frontend work (docs/SITE_BUILDER.md).
//
// A content type can now declare a `routePattern` (e.g. "/blog/{slug}") in the CMS admin.
// `resolveRoute()` lets a generic Astro catch-all route ask "what CMS resource, if any, does
// this URL belong to?" without a developer wiring a specific Astro page per content type — the
// concrete mechanism behind Scenario 1/2 in docs/SITE_BUILDER.md (a new content type's entries
// become reachable with zero Astro source changes).
//
// V1 SCOPE (docs/SITE_BUILDER.md §14 decision #2, resolved): a route pattern supports EXACTLY
// one required "{slug}" parameter — no multiple parameters, optional segments, wildcards,
// regex, or localization segments. Richer pattern grammar is deliberately deferred; this
// resolver is written so that can be introduced later without changing its public shape.
//
// WHAT THIS DOES NOT DO YET: there are no Pages in this codebase (Phase 3+, not started) — so
// `resolveRoute()` can only ever resolve to an `entry` or `notFound` today, and it returns only
// the identity (`contentTypeSlug`/`slug`), not the fetched entry itself — call
// `client.entries.get({contentType, slug})` with the result to get the real entry. Its result
// type is intentionally a discriminated union so a `page` variant can be added later (additive,
// never breaking existing callers who already switch on `kind`).

import type { RoutePatternEntry } from '@kenresoft-cms/contracts';

export type { RoutePatternEntry };

export type ResolvedRoute =
  | { kind: 'entry'; contentTypeSlug: string; slug: string }
  | { kind: 'notFound' };

/**
 * Match a single route pattern (e.g. "/blog/{slug}") against a real pathname (e.g.
 * "/blog/hello-world"). Returns the slug value on a match, or `null` otherwise.
 *
 * Since a pattern's literal segments must match exactly and "{slug}" is always its final
 * segment (enforced by `routePatternSchema` server-side — see packages/contracts/schemas/
 * routing.ts), this is a plain segment-by-segment comparison, not a general templating engine.
 */
export function matchRoutePattern(pattern: string, pathname: string): string | null {
  const patternSegments = pattern.split('/').filter((segment) => segment.length > 0);
  const pathSegments = pathname.split('/').filter((segment) => segment.length > 0);

  if (patternSegments.length !== pathSegments.length || patternSegments.length === 0) {
    return null;
  }

  const slugIndex = patternSegments.length - 1;
  if (patternSegments[slugIndex] !== '{slug}') {
    // A malformed pattern (shouldn't happen — the server validates this), never matches.
    return null;
  }

  for (let i = 0; i < slugIndex; i++) {
    if (patternSegments[i] !== pathSegments[i]) return null;
  }

  const slug = pathSegments[slugIndex];
  return slug !== undefined && slug.length > 0 ? decodeURIComponent(slug) : null;
}

/**
 * Resolve a pathname to the content type/slug it belongs to, given the deployment's current
 * route patterns (fetch these once per request via a client's route pattern listing — see
 * `createKenresoftClient(...).routePatterns.list()`). Patterns are checked in the order given;
 * since two content types can never share a route pattern (the CMS enforces this at write
 * time), at most one pattern can ever match a given pathname — resolution is deterministic
 * regardless of array order.
 */
export function resolveRoute(pathname: string, patterns: RoutePatternEntry[]): ResolvedRoute {
  for (const { contentTypeSlug, routePattern } of patterns) {
    const slug = matchRoutePattern(routePattern, pathname);
    if (slug !== null) {
      return { kind: 'entry', contentTypeSlug, slug };
    }
  }
  return { kind: 'notFound' };
}
