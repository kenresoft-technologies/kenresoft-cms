import { describe, expect, it } from 'vitest';

import { isSafeHref, sanitizeReplyHtml } from '../src/lib/html-sanitizer';
import { sanitizeRawHtml } from '../src/lib/raw-html-sanitizer';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);

describe('sanitizeRawHtml', () => {
  it('keeps layout markup, classes, safe styles and safe links/images', () => {
    const input =
      '<section class="hero" style="background-color: #eee; padding: 24px"><h1>Hi</h1>' +
      '<a href="https://example.com/x?a=1&amp;b=2" target="_blank">go</a>' +
      '<img src="https://cdn.example.com/a.png" alt="A" width="100"></section>';
    const out = sanitizeRawHtml(input);
    expect(out).toContain('<section class="hero" style="background-color: #eee; padding: 24px">');
    expect(out).toContain('href="https://example.com/x?a=1&amp;b=2"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('<img src="https://cdn.example.com/a.png" alt="A" width="100" loading="lazy">');
  });

  it('drops dangerous elements together with their content', () => {
    const out = sanitizeRawHtml(
      '<p>a</p><script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test"></iframe>' +
        '<svg onload="alert(1)"><circle/></svg><object data="x"></object><embed src="x"><form action="/x"><input></form><p>b</p>',
    );
    expect(out).toBe('<p>a</p><p>b</p>');
  });

  it('strips event handlers, id, name, srcdoc and unknown attributes', () => {
    const out = sanitizeRawHtml('<div id="x" onclick="alert(1)" onmouseover="a()" data-x="1" srcdoc="y" name="z" class="ok">t</div>');
    expect(out).toBe('<div class="ok">t</div>');
  });

  it('rejects javascript:/data:/vbscript: URLs, including whitespace and entity obfuscation', () => {
    const cases = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      `java${TAB}script:alert(1)`,
      `java${NEWLINE}script:alert(1)`,
      'javascript&colon;alert(1)',
      'java&#115;cript:alert(1)',
      'java&#x73;cript:alert(1)',
      'java&Tab;script:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.test/x',
    ];
    for (const href of cases) {
      const out = sanitizeRawHtml(`<a href="${href}">x</a>`);
      expect(out, href).toBe('<a>x</a>');
    }
    expect(sanitizeRawHtml('<a href="/relative">x</a>')).toBe('<a href="/relative">x</a>');
    expect(sanitizeRawHtml('<a href="mailto:a@b.co">x</a>')).toBe('<a href="mailto:a@b.co">x</a>');
  });

  it('only allows http(s) or relative image sources', () => {
    expect(sanitizeRawHtml('<img src="data:image/png;base64,AAAA">')).toBe('<img loading="lazy">');
    expect(sanitizeRawHtml('<img src="javascript:alert(1)">')).toBe('<img loading="lazy">');
    expect(sanitizeRawHtml('<img src="//evil.test/a.png">')).toBe('<img loading="lazy">');
    expect(sanitizeRawHtml('<img src="/media/a.png">')).toContain('src="/media/a.png"');
  });

  it('filters inline styles: no position/overlay properties, url(), expression() or negative offsets', () => {
    const out = sanitizeRawHtml(
      '<div style="position: fixed; top: 0; z-index: 9999; background: url(https://evil.test/x.png); color: red; ' +
        'margin-left: -500px; width: expression(alert(1)); display: none; transform: scale(9); behavior: url(x)">t</div>',
    );
    expect(out).toBe('<div style="color: red; display: none">t</div>');
    expect(sanitizeRawHtml('<div style="display: contents">t</div>')).toBe('<div>t</div>');
  });

  it('balances tags so a block cannot break out of or swallow its container', () => {
    expect(sanitizeRawHtml('<div><p>open')).toBe('<div><p>open</p></div>');
    expect(sanitizeRawHtml('</div></section><p>x</p>')).toBe('<p>x</p>');
    expect(sanitizeRawHtml('<div><span></div>after')).toBe('<div><span></span></div>after');
  });

  it('escapes stray angle brackets and comments cannot smuggle markup', () => {
    expect(sanitizeRawHtml('a < b > c')).toBe('a &lt; b &gt; c');
    const out = sanitizeRawHtml('<!-- <script>alert(1)</script> --><p>ok</p>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>ok</p>');
  });

  it('quote-tricked tags cannot smuggle a second tag', () => {
    const out = sanitizeRawHtml('<a title="x><script>alert(1)</script>" href="/a">t</a>');
    expect(out).not.toContain('<script');
  });

  it('is idempotent', () => {
    const inputs = [
      '<div class="a" style="color: red; padding: 4px"><a href="https://x.test/?a=1&b=2" target="_blank">l</a><img src="/a.png" alt="q&quot;q"></div>',
      '<p>a &nbsp; &amp; b & c</p><table><tr><td colspan="2">x',
      '<script>x</script><b>bold<i>it</b>',
    ];
    for (const input of inputs) {
      const once = sanitizeRawHtml(input);
      expect(sanitizeRawHtml(once)).toBe(once);
    }
  });
});

describe('shared href check (also used by reply sanitising)', () => {
  it('rejects tab/newline-obfuscated javascript: schemes', () => {
    expect(isSafeHref(`java${TAB}script:alert(1)`)).toBe(false);
    expect(isSafeHref(`java${NEWLINE}script:alert(1)`)).toBe(false);
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(sanitizeReplyHtml(`<a href="java${TAB}script:alert(1)">x</a>`)).toBe('<a>x</a>');
  });
});
