// Navigation `pageId` reference resolution — Phase 6 of the schema-driven frontend work
// (docs/SITE_BUILDER.md §3.7).
//
// `navigationItemSchema` (packages/contracts/schemas/structured-settings.ts) accepts either a
// literal `url` or a `pageId` referencing a Page. A frontend can't render a `pageId` directly —
// it needs that Page's own `route` — so this module resolves a whole navigation list against a
// set of known pages in one pass, producing a flat list with a real `href` on every item
// regardless of which target type it was authored with.
//
// A `pageId` that doesn't match any given page (the Page was deleted after the nav item was
// created — Structured Settings doesn't cascade-delete or validate this at write time) resolves
// to `href: null` rather than throwing, so a template can choose how to handle a dangling
// reference (skip it, render disabled, etc.) instead of the whole navigation render failing.

import type { NavigationItem, PageListItem } from '@kenresoft-cms/contracts';

export type ResolvedNavigationItem = {
  label: string;
  href: string | null;
  visible: boolean;
  order: number;
  external: boolean;
  newTab: boolean;
};

/**
 * Resolve every navigation item's target to a real `href`. `pages` should be the result of
 * `client.pages.list()` (or any array of `{id, route}` pairs) — only `id`/`route` are read.
 */
export function resolveNavigationItems(
  items: NavigationItem[],
  pages: Pick<PageListItem, 'id' | 'route'>[],
): ResolvedNavigationItem[] {
  const routeById = new Map(pages.map((page) => [page.id, page.route]));

  return items.map(({ label, visible, order, external, newTab, ...target }) => ({
    label,
    visible,
    order,
    external,
    newTab,
    href: 'pageId' in target ? (routeById.get(target.pageId) ?? null) : target.url,
  }));
}
