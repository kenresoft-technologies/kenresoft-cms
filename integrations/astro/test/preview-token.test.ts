// Pure unit tests for getPreviewToken() — see field-renderers.test.ts for the "pure logic,
// node --test" precedent this follows. createKenresoftClient()'s own use of this (the
// `previewToken` client-config default — see index.ts's KenresoftClientConfig doc comment) is
// deliberately not exercised here: index.ts's barrel file re-exports several sibling modules
// via extension-less specifiers (fine for a bundler/tsc, not resolvable by Node's own ESM loader
// running raw .ts sources directly), so — like every other file in this directory — this test
// only imports one small, standalone module directly, never index.ts itself.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getPreviewToken } from '../src/get-preview-token.ts';

describe('getPreviewToken', () => {
  it('extracts preview_token from a URL', () => {
    assert.equal(getPreviewToken(new URL('https://example.com/blog/x?preview_token=abc')), 'abc');
  });

  it('extracts preview_token from an absolute URL string', () => {
    assert.equal(getPreviewToken('https://example.com/blog/x?preview_token=abc'), 'abc');
  });

  it('extracts preview_token from a Request', () => {
    assert.equal(getPreviewToken(new Request('https://example.com/blog/x?preview_token=abc')), 'abc');
  });

  it('returns null when the param is absent', () => {
    assert.equal(getPreviewToken(new URL('https://example.com/blog/x')), null);
  });

  it('decodes a URL-encoded token value', () => {
    assert.equal(getPreviewToken(new URL('https://example.com/blog/x?preview_token=a%2Bb')), 'a+b');
  });
});
