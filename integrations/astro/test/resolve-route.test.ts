// Pure unit tests for Phase 2's dynamic-routing primitives (docs/SITE_BUILDER.md) — see
// field-renderers.test.ts for the "pure logic, node --test" precedent this follows.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchRoutePattern, resolveRoute, type RoutePatternEntry } from '../src/render/resolve-route.ts';

describe('matchRoutePattern', () => {
  it('matches a single-segment pattern and extracts the slug', () => {
    assert.equal(matchRoutePattern('/blog/{slug}', '/blog/hello-world'), 'hello-world');
  });

  it('matches a root-level pattern with no literal prefix', () => {
    assert.equal(matchRoutePattern('/{slug}', '/hello-world'), 'hello-world');
  });

  it('matches a multi-segment literal prefix', () => {
    assert.equal(matchRoutePattern('/news/latest/{slug}', '/news/latest/my-post'), 'my-post');
  });

  it('returns null when the literal prefix does not match', () => {
    assert.equal(matchRoutePattern('/blog/{slug}', '/news/hello-world'), null);
  });

  it('returns null when the segment count differs', () => {
    assert.equal(matchRoutePattern('/blog/{slug}', '/blog/2026/hello-world'), null);
    assert.equal(matchRoutePattern('/blog/{slug}', '/blog'), null);
  });

  it('returns null for an empty slug segment (trailing slash)', () => {
    assert.equal(matchRoutePattern('/blog/{slug}', '/blog/'), null);
  });

  it('is exact — never matches a path that merely starts with the same prefix', () => {
    assert.equal(matchRoutePattern('/blog/{slug}', '/blog-archive/hello-world'), null);
  });

  it('decodes a URL-encoded slug segment', () => {
    assert.equal(matchRoutePattern('/blog/{slug}', '/blog/caf%C3%A9-review'), 'café-review');
  });
});

describe('resolveRoute', () => {
  const patterns: RoutePatternEntry[] = [
    { contentTypeSlug: 'blog', routePattern: '/blog/{slug}' },
    { contentTypeSlug: 'team', routePattern: '/team/{slug}' },
  ];

  it('resolves to the matching content type and slug', () => {
    assert.deepEqual(resolveRoute('/blog/hello-world', patterns), {
      kind: 'entry',
      contentTypeSlug: 'blog',
      slug: 'hello-world',
    });
  });

  it('resolves a different content type correctly', () => {
    assert.deepEqual(resolveRoute('/team/jane-doe', patterns), {
      kind: 'entry',
      contentTypeSlug: 'team',
      slug: 'jane-doe',
    });
  });

  it('resolves to notFound for a path matching no pattern', () => {
    assert.deepEqual(resolveRoute('/does-not-exist/x', patterns), { kind: 'notFound' });
  });

  it('resolves to notFound for an empty pattern list (no content type has opted in)', () => {
    assert.deepEqual(resolveRoute('/blog/hello-world', []), { kind: 'notFound' });
  });

  it('checking a second, unrelated pattern first does not cause a false match', () => {
    // Proves resolution is deterministic regardless of array order — see the doc comment on
    // resolveRoute() explaining why this holds given the server's own uniqueness guarantee.
    const reordered = [...patterns].reverse();
    assert.deepEqual(resolveRoute('/blog/hello-world', reordered), {
      kind: 'entry',
      contentTypeSlug: 'blog',
      slug: 'hello-world',
    });
  });
});
