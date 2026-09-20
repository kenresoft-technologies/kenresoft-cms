import { describe, expect, it } from 'vitest';
import { htmlToPlainText, stripTags } from '../src/lib/html-to-text';

describe('htmlToPlainText', () => {
  it('turns block tags into line breaks', () => {
    expect(htmlToPlainText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });

  it('keeps double-escaped entities as literal text', () => {
    expect(htmlToPlainText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('cannot rebuild a tag from nested angle brackets', () => {
    expect(stripTags('<<b>script>alert(1)<</b>/script>')).not.toContain('<');
  });
});
