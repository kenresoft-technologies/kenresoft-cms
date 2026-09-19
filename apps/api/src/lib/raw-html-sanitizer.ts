import { isSafeHref, parseAttributes, tokenize } from './html-sanitizer';

// Sanitizer for the Site Builder's "Raw HTML" block — deliberately much stricter than "trust the
// admin". The output is served to every visitor of a public site, so it must be safe even if an
// admin account is compromised or pastes markup from an untrusted source. Guarantees:
//   * Only allow-listed tags/attributes survive. No script, style, iframe, object, embed, form,
//     input, svg, math, base, link, meta, video/audio — and the content of those elements is
//     dropped entirely, not shown as text.
//   * No event handlers, no `id`/`name` (DOM clobbering), no `srcdoc`, no data:/javascript:/
//     vbscript: URLs; images may only load over http(s) or a relative path.
//   * Inline `style` is filtered to a property allow-list; no `position`/`z-index`/`transform`
//     (no visual overlays or clickjacking), no url()/expression()/@import, no negative offsets.
//   * Tags are balanced: unclosed tags are closed at the end and stray closing tags dropped, so
//     the block can never break out of its container or swallow the rest of the page.
//   * Idempotent: sanitize(sanitize(x)) === sanitize(x), so an unchanged, already-stored block
//     compares equal on re-save.
// Same dependency-free tokenizer as html-sanitizer.ts (see the note there on why no npm parser).

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);

const ALLOWED_TAGS = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'mark', 'sub',
  'sup', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'pre',
  'code', 'details', 'summary', 'abbr', 'cite', 'q', 'time',
]);

// Elements whose *contents* are dropped as well (never rendered as visible text). Fail-closed: if
// one is never closed, the rest of the input is dropped rather than risk rendering it. Void
// elements (embed, input, link, meta...) are deliberately not listed — they simply aren't
// allow-listed, so only the tag itself is dropped and what follows is unaffected.
const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'noscript', 'template', 'textarea', 'title',
  'svg', 'math', 'xmp', 'plaintext', 'select', 'option', 'applet',
]);

const GLOBAL_ATTRIBUTES = new Set(['class', 'title', 'lang', 'dir', 'style', 'aria-label', 'aria-hidden']);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'target']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  time: new Set(['datetime']),
};

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'background', 'font-size', 'font-weight', 'font-style', 'font-family',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'text-indent',
  'vertical-align', 'white-space', 'margin', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color',
  'border-width', 'border-style', 'border-radius', 'border-collapse', 'width', 'max-width',
  'min-width', 'height', 'max-height', 'min-height', 'display', 'flex', 'flex-direction',
  'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'align-items', 'justify-content', 'align-self', 'opacity', 'box-shadow',
  'list-style', 'list-style-type', 'object-fit',
]);

const SAFE_DISPLAY_VALUES = new Set(['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none']);
// Letters, digits and the punctuation real CSS values use. Excludes backslash (CSS escapes),
// semicolon, braces, angle brackets, `@`, `:` and `/` — so url(http://...)-style values and
// scheme tricks cannot fit at all.
const SAFE_STYLE_VALUE = /^[a-zA-Z0-9#%.,()\s"'+\-!]*$/;
const NEGATIVE_NUMBER = /(^|[\s(,])-\s*[0-9.]/;

function filterStyle(raw: string): string {
  const kept: string[] = [];
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.has(property) || value.length === 0) continue;
    if (!SAFE_STYLE_VALUE.test(value)) continue;
    const lowered = value.toLowerCase();
    if (lowered.includes('url(') || lowered.includes('expression') || lowered.includes('javascript')) continue;
    if (NEGATIVE_NUMBER.test(value)) continue;
    if (property === 'display' && !SAFE_DISPLAY_VALUES.has(lowered)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.join('; ');
}

// Browsers ignore ASCII whitespace/control characters inside a URL scheme, so they are removed
// before any scheme check (built with char codes, not a regex, to keep the source unambiguous).
function stripUrlControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 32 || (code >= 127 && code <= 159)) continue;
    out += ch;
  }
  return out;
}

// Browsers decode character references inside attribute values BEFORE parsing a URL, so
// `javascript&colon;alert(1)` or `java&#115;cript:` is javascript: to the browser. URL checks run
// on the decoded value. (Only numeric references and the named ones that produce a colon, tab or
// newline can matter for a scheme; every other reference cannot create one.)
function decodeReferencesForUrlCheck(value: string): string {
  const safeCodePoint = (n: number) => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&colon;/gi, String.fromCharCode(58))
    .replace(/&tab;/gi, String.fromCharCode(9))
    .replace(/&newline;/gi, String.fromCharCode(10));
}

// Images may only load over http(s) or from a relative path — never data:, blob:, javascript:,
// protocol-relative, or any other scheme.
function isSafeImageSrc(value: string): boolean {
  const stripped = stripUrlControlChars(decodeReferencesForUrlCheck(value));
  if (stripped.length === 0 || stripped.startsWith('//')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
  if (!scheme) return true;
  const name = scheme[1]!.toLowerCase();
  return name === 'http' || name === 'https';
}

// Attribute values keep valid references (idempotent re-sanitising: `&amp;` stays `&amp;`, not
// `&amp;amp;`); a bare `&`, quotes and angle brackets are escaped.
function escapeRawAttribute(value: string): string {
  return value
    .replace(/&(?!#?[a-zA-Z0-9]{1,32};)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Keeps valid character/numeric references (so `&nbsp;` and `&amp;` in pasted copy survive);
// a bare `&` and every `<`/`>` are escaped. References in *text* can never form markup.
function escapeRawText(text: string): string {
  return text
    .replace(/&(?!#?[a-zA-Z0-9]{1,32};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const DIGITS = /^[0-9]{1,4}$/;

export function sanitizeRawHtml(html: string): string {
  const tokens = tokenize(html);
  const open: string[] = [];
  let output = '';
  let dropUntil: string | null = null;

  for (const token of tokens) {
    if (dropUntil) {
      if (token.type === 'tag' && token.closing && token.tagName === dropUntil) dropUntil = null;
      continue;
    }

    if (token.type === 'text') {
      output += escapeRawText(token.value);
      continue;
    }

    if (DROP_CONTENT_TAGS.has(token.tagName)) {
      if (!token.closing) dropUntil = token.tagName;
      continue;
    }
    if (!ALLOWED_TAGS.has(token.tagName)) continue;

    if (token.closing) {
      const index = open.lastIndexOf(token.tagName);
      if (index < 0) continue; // stray closing tag
      while (open.length > index) output += `</${open.pop()}>`;
      continue;
    }

    const parsed = parseAttributes(token.rawAttributes);
    const allowed = TAG_ATTRIBUTES[token.tagName];
    const kept: string[] = [];

    for (const [name, value] of parsed) {
      if (!GLOBAL_ATTRIBUTES.has(name) && !allowed?.has(name)) continue;
      if (name === 'style') {
        const filtered = filterStyle(value);
        if (filtered) kept.push(`style="${escapeRawAttribute(filtered)}"`);
        continue;
      }
      if (name === 'href' && !isSafeHref(decodeReferencesForUrlCheck(value))) continue;
      if (name === 'src' && !isSafeImageSrc(value)) continue;
      if (name === 'target' && value !== '_blank') continue;
      if ((name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan') && !DIGITS.test(value)) continue;
      if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(value.toLowerCase())) continue;
      if (name === 'scope' && !['row', 'col', 'rowgroup', 'colgroup'].includes(value.toLowerCase())) continue;
      kept.push(`${name}="${escapeRawAttribute(value)}"`);
    }
    if (token.tagName === 'a' && kept.some((attr) => attr.startsWith('target='))) {
      kept.push('rel="noopener noreferrer"');
    }
    if (token.tagName === 'img') kept.push('loading="lazy"');

    output += kept.length > 0 ? `<${token.tagName} ${kept.join(' ')}>` : `<${token.tagName}>`;
    if (!VOID_TAGS.has(token.tagName)) open.push(token.tagName);
  }

  while (open.length > 0) output += `</${open.pop()}>`;
  return output;
}
