// Pure unit tests for Phase 7's block-renderer override registry (docs/SITE_BUILDER.md §6) —
// see field-renderers.test.ts for the "pure logic, node --test" precedent this follows.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerBlockRenderer, resolveBlockRenderer } from '../src/render/block-renderers.ts';

describe('registerBlockRenderer / resolveBlockRenderer', () => {
  it('resolves undefined for a block type with no registered override', () => {
    assert.equal(resolveBlockRenderer('nonexistent-block-type'), undefined);
  });

  it('resolves a registered override by block type', () => {
    const MyHero = { name: 'MyHero' };
    registerBlockRenderer('hero-test-1', MyHero);
    assert.equal(resolveBlockRenderer('hero-test-1'), MyHero);
  });

  it('the last registration for a given type wins', () => {
    const First = { name: 'First' };
    const Second = { name: 'Second' };
    registerBlockRenderer('hero-test-2', First);
    registerBlockRenderer('hero-test-2', Second);
    assert.equal(resolveBlockRenderer('hero-test-2'), Second);
  });
});
