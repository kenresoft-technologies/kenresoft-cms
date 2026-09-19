import { isSafeHref, parseAttributes, tokenize } from './html-sanitizer';

// Sanitizers for staff-pasted HTML that is published or sent to other people — deliberately much
// stricter than "trust the admin". The output is served to every visitor of a public site (page
// preset) or delivered to external recipients (email preset), so it must be safe even if an admin
// account is compromised or pastes markup from an untrusted source. Guarantees, for both presets:
//   * Only allow-listed tags/attributes survive. No script, style, iframe, object, embed, form,
//     input, svg, math, base, link, meta, video/audio — and the content of those elements is
//     dropped entirely, not shown as text.
//   * No event handlers, no `id`/`name` (DOM clobbering), no `srcdoc`, no data:/javascript:/
//     vbscript: URLs; images may only load over http(s) (page preset also allows relative paths).
//   * Inline `style` is filtered to a property allow-list; no `position`/`z-index`/`transform`
//     (no visual overlays or clickjacking), no url()/expression()/@import, no negative offsets.
//   * Tags are balanced: unclosed tags are closed at the end and stray closing tags dropped, so
//     the output can never break out of its container or swallow what surrounds it.
//   * Idempotent: sanitize(sanitize(x)) === sanitize(x), so an unchanged, already-stored block
//     compares equal on re-save.
// Same dependency-free tokenizer as html-sanitizer.ts (see the note there on why no npm parser).

interface SanitizerConfig {
  allowedTags: Set<string>;
  voidTags: Set<string>;
  globalAttributes: Set<string>;
  tagAttributes: Record<string, Set<string>>;
  styleProperties: Set<string>;
  displayValues: Set<string>;
  // Extra per-attribute value checks (an attribute without an entry here is kept as-is once it
  // is allow-listed for its tag).
  attributeValidators: Record<string, (value: string) => boolean>;
  allowRelativeUrls: boolean;
  // Emitted on every <img> (e.g. loading="lazy").
  imageExtraAttributes: string[];
  // Drop images that are 0-2px wide/high — the classic email tracking pixel.
  dropTrackingPixels?: boolean;
}

const DIGITS = /^[0-9]{1,4}$/;
const LENGTH = /^[0-9]{1,4}%?$/;

const PAGE_TAGS = [
  'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'mark', 'sub',
  'sup', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'pre',
  'code', 'details', 'summary', 'abbr', 'cite', 'q', 'time',
];

const PAGE_STYLE_PROPERTIES = [
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
];

const PAGE_CONFIG: SanitizerConfig = {
  allowedTags: new Set(PAGE_TAGS),
  voidTags: new Set(['br', 'hr', 'img', 'col']),
  globalAttributes: new Set(['class', 'title', 'lang', 'dir', 'style', 'aria-label', 'aria-hidden']),
  tagAttributes: {
    a: new Set(['href', 'target']),
    img: new Set(['src', 'alt', 'width', 'height']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan', 'scope']),
    time: new Set(['datetime']),
  },
  styleProperties: new Set(PAGE_STYLE_PROPERTIES),
  displayValues: new Set(['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none']),
  attributeValidators: {
    width: (v) => DIGITS.test(v),
    height: (v) => DIGITS.test(v),
    colspan: (v) => DIGITS.test(v),
    rowspan: (v) => DIGITS.test(v),
    dir: (v) => ['ltr', 'rtl', 'auto'].includes(v.toLowerCase()),
    scope: (v) => ['row', 'col', 'rowgroup', 'colgroup'].includes(v.toLowerCase()),
    target: (v) => v === '_blank',
  },
  allowRelativeUrls: true,
  imageExtraAttributes: ['loading="lazy"'],
};

// Email templates (Canva, Mailchimp, hand-coded) are table-based layouts with inline styles and
// presentational attributes, because mail clients ignore most modern CSS. Same safety rules as the
// page preset; differences: legacy layout attributes, table display values, absolute URLs only
// (a relative link or image means nothing to a recipient), no lazy-loading attribute.
const EMAIL_STYLE_PROPERTIES = [
  ...PAGE_STYLE_PROPERTIES,
  'font', 'border-spacing', 'table-layout', 'word-break', 'overflow-wrap', 'text-shadow',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
  'border-bottom-right-radius',
];

const EMAIL_CONFIG: SanitizerConfig = {
  dropTrackingPixels: true,
  allowedTags: new Set([...PAGE_TAGS, 'center', 'font']),
  voidTags: new Set(['br', 'hr', 'img', 'col']),
  globalAttributes: new Set([
    'class', 'title', 'lang', 'dir', 'style', 'aria-label', 'aria-hidden', 'align', 'valign',
    'bgcolor', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'role',
  ]),
  tagAttributes: {
    a: new Set(['href', 'target']),
    img: new Set(['src', 'alt']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan', 'scope']),
    font: new Set(['color', 'size']),
  },
  styleProperties: new Set(EMAIL_STYLE_PROPERTIES),
  displayValues: new Set(['block', 'inline', 'inline-block', 'none', 'table', 'table-cell', 'table-row']),
  attributeValidators: {
    width: (v) => LENGTH.test(v),
    height: (v) => LENGTH.test(v),
    border: (v) => DIGITS.test(v),
    cellpadding: (v) => DIGITS.test(v),
    cellspacing: (v) => DIGITS.test(v),
    colspan: (v) => DIGITS.test(v),
    rowspan: (v) => DIGITS.test(v),
    dir: (v) => ['ltr', 'rtl', 'auto'].includes(v.toLowerCase()),
    scope: (v) => ['row', 'col', 'rowgroup', 'colgroup'].includes(v.toLowerCase()),
    target: (v) => v === '_blank',
    align: (v) => ['left', 'right', 'center', 'justify'].includes(v.toLowerCase()),
    valign: (v) => ['top', 'middle', 'bottom', 'baseline'].includes(v.toLowerCase()),
    bgcolor: (v) => /^#?[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{3,20}$/.test(v),
    color: (v) => /^#?[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{3,20}$/.test(v),
    size: (v) => /^[+-]?[1-7]$/.test(v),
    role: (v) => v.toLowerCase() === 'presentation',
  },
  allowRelativeUrls: false,
  imageExtraAttributes: [],
};

// Elements whose *contents* are dropped as well (never rendered as visible text). Fail-closed: if
// one is never closed, the rest of the input is dropped rather than risk rendering it. Void
// elements (embed, input, link, meta...) are deliberately not listed — they simply aren't
// allow-listed, so only the tag itself is dropped and what follows is unaffected.
const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'noscript', 'template', 'textarea', 'title',
  'svg', 'math', 'xmp', 'plaintext', 'select', 'option', 'applet',
]);

const SAFE_DISPLAY_FALLBACK = new Set<string>();
// Letters, digits and the punctuation real CSS values use. Excludes backslash (CSS escapes),
// semicolon, braces, angle brackets, `@`, `:` and `/` — so url(http://...)-style values and
// scheme tricks cannot fit at all.
const SAFE_STYLE_VALUE = /^[a-zA-Z0-9#%.,()\s"'+\-!]*$/;
const NEGATIVE_NUMBER = /(^|[\s(,])-\s*[0-9.]/;

function filterStyle(raw: string, config: SanitizerConfig): string {
  const kept: string[] = [];
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!config.styleProperties.has(property) || value.length === 0) continue;
    if (!SAFE_STYLE_VALUE.test(value)) continue;
    const lowered = value.toLowerCase();
    if (lowered.includes('url(') || lowered.includes('expression') || lowered.includes('javascript')) continue;
    if (NEGATIVE_NUMBER.test(value)) continue;
    if (property === 'display' && !(config.displayValues ?? SAFE_DISPLAY_FALLBACK).has(lowered)) continue;
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

// Images may only load over http(s) (and, for pages, from a relative path) — never data:, blob:,
// javascript:, protocol-relative, or any other scheme.
function isSafeImageSrc(value: string, config: SanitizerConfig): boolean {
  const stripped = stripUrlControlChars(decodeReferencesForUrlCheck(value));
  if (stripped.length === 0 || stripped.startsWith('//')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
  if (!scheme) return config.allowRelativeUrls;
  const name = scheme[1]!.toLowerCase();
  return name === 'http' || name === 'https';
}

function isSafeLink(value: string, config: SanitizerConfig): boolean {
  const decoded = decodeReferencesForUrlCheck(value);
  if (!isSafeHref(decoded)) return false;
  if (config.allowRelativeUrls) return true;
  // Absolute only: a relative link is meaningless once it is in someone's inbox.
  return /^(https?|mailto):/i.test(stripUrlControlChars(decoded));
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

const MAX_NESTING_DEPTH = 100;

// A 0-2px image (by attribute or inline style) exists only to report that an email was opened.
function isTrackingPixel(attrs: Map<string, string>): boolean {
  const tiny = (value: string | undefined) => value !== undefined && /^s*[0-2](px)?s*$/i.test(value);
  const style = attrs.get('style') ?? '';
  return (
    tiny(attrs.get('width')) ||
    tiny(attrs.get('height')) ||
    /(^|;)s*(width|height)s*:s*[0-2](px)?s*(;|$)/i.test(style)
  );
}

function sanitizeWith(html: string, config: SanitizerConfig): string {
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
    if (!config.allowedTags.has(token.tagName)) continue;

    if (token.closing) {
      const index = open.lastIndexOf(token.tagName);
      if (index < 0) continue; // stray closing tag
      while (open.length > index) output += `</${open.pop()}>`;
      continue;
    }

    // Real documents nest a few dozen levels at most; tens of thousands of open tags only serve
    // to make browsers and mail clients slow or crash, so anything deeper is dropped.
    if (!config.voidTags.has(token.tagName) && open.length >= MAX_NESTING_DEPTH) continue;

    const parsed = parseAttributes(token.rawAttributes);
    if (token.tagName === 'img' && config.dropTrackingPixels && isTrackingPixel(parsed)) continue;
    const allowed = config.tagAttributes[token.tagName];
    const kept: string[] = [];

    for (const [name, value] of parsed) {
      // `color` is only meaningful on <font>; it is not a global attribute.
      if (!config.globalAttributes.has(name) && !allowed?.has(name)) continue;
      if (name === 'style') {
        const filtered = filterStyle(value, config);
        if (filtered) kept.push(`style="${escapeRawAttribute(filtered)}"`);
        continue;
      }
      if (name === 'href' && !isSafeLink(value, config)) continue;
      if (name === 'src' && !isSafeImageSrc(value, config)) continue;
      const validator = config.attributeValidators[name];
      if (validator && !validator(value)) continue;
      kept.push(`${name}="${escapeRawAttribute(value)}"`);
    }
    if (token.tagName === 'a' && kept.some((attr) => attr.startsWith('target='))) {
      kept.push('rel="noopener noreferrer"');
    }
    if (token.tagName === 'img') kept.push(...config.imageExtraAttributes);

    output += kept.length > 0 ? `<${token.tagName} ${kept.join(' ')}>` : `<${token.tagName}>`;
    if (!config.voidTags.has(token.tagName)) open.push(token.tagName);
  }

  while (open.length > 0) output += `</${open.pop()}>`;
  return output;
}

// The Site Builder's Raw HTML block (public pages).
export function sanitizeRawHtml(html: string): string {
  return sanitizeWith(html, PAGE_CONFIG);
}

// A designed (template-style) HTML email — tables, inline styles, absolute https images/links.
// A full pasted document is fine: <html>/<head>/<body>/<style>/<title> and everything in <head>
// that is not allow-listed is dropped, leaving the body content.
export function sanitizeEmailHtml(html: string): string {
  return sanitizeWith(html, EMAIL_CONFIG);
}
