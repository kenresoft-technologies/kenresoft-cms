// Pure unit tests for Phase 6's Navigation `pageId` resolution (docs/SITE_BUILDER.md §3.7) —
// see field-renderers.test.ts for the "pure logic, node --test" precedent this follows.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveNavigationItems } from '../src/render/resolve-navigation.ts';
import type { NavigationItem, PageListItem } from '@kenresoft-cms/contracts';

const pages: PageListItem[] = [
  { id: 'page-1', route: '/about', title: 'About us' },
  { id: 'page-2', route: '/contact', title: 'Contact' },
];

describe('resolveNavigationItems', () => {
  it('resolves a plain url item unchanged', () => {
    const items: NavigationItem[] = [
      { label: 'Home', url: '/', visible: true, order: 0, external: false, newTab: false },
    ];
    assert.deepEqual(resolveNavigationItems(items, pages), [
      { label: 'Home', href: '/', visible: true, order: 0, external: false, newTab: false },
    ]);
  });

  it('resolves a pageId item to that page\'s own route', () => {
    const items: NavigationItem[] = [
      { label: 'About', pageId: 'page-1', visible: true, order: 0, external: false, newTab: false },
    ];
    assert.deepEqual(resolveNavigationItems(items, pages), [
      { label: 'About', href: '/about', visible: true, order: 0, external: false, newTab: false },
    ]);
  });

  it('resolves a dangling pageId reference to a null href rather than throwing', () => {
    const items: NavigationItem[] = [
      { label: 'Deleted page', pageId: 'nonexistent', visible: true, order: 0, external: false, newTab: false },
    ];
    assert.deepEqual(resolveNavigationItems(items, pages), [
      { label: 'Deleted page', href: null, visible: true, order: 0, external: false, newTab: false },
    ]);
  });

  it('resolves a mixed list of url and pageId items in order', () => {
    const items: NavigationItem[] = [
      { label: 'Home', url: '/', visible: true, order: 0, external: false, newTab: false },
      { label: 'Contact', pageId: 'page-2', visible: true, order: 1, external: false, newTab: false },
    ];
    const resolved = resolveNavigationItems(items, pages);
    assert.equal(resolved[0]?.href, '/');
    assert.equal(resolved[1]?.href, '/contact');
  });
});
