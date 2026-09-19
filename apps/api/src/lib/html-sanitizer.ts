// A single, strict allow-list shared by everything in this codebase that persists
// staff-authored HTML meant to be rendered later (currently: form-submission replies,
// apps/api/src/routes/admin/forms.ts). Deliberately narrower than a general "trust the editor"
// rich-text field (entries.rich_text, Site Builder's RichText block) — a submission reply
// thread is read by every role with Forms/Submissions access (including Viewer), so this
// closes a stored-XSS path server-side rather than relying on the Admin Tiptap editor alone to
// never produce anything dangerous.
//
// A first attempt used the `sanitize-html` npm package, but its `htmlparser2` dependency threw
// ("Cannot read properties of undefined (reading 'Parser')") under `@cloudflare/
// vitest-pool-workers`' own module loader — the same class of Workers-runtime-vs-Node-package
// mismatch this codebase has hit before (see form-submission-validation.ts's own comment: "No
// DOM parser is available in the Workers runtime"). Rather than ship a dependency unverified in
// the actual runtime this code executes in, this is a small, dependency-free tokenizer —
// correctly quote-aware (a `>` inside a quoted attribute value never ends a tag early, and a
// stray unmatched `<` is escaped as text, never left able to start a tag later in the output).
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'a', 'code', 'pre', 'span',
]);

// Only these attributes ever survive, and only on the tags listed — everything else (onclick,
// style, id, class on arbitrary tags, ...) is dropped regardless of the tag.
// `rel` is deliberately not in this list — it's computed automatically below whenever a kept
// `target="_blank"` survives, never taken verbatim from the input.
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target']),
  span: new Set(['class']),
  code: new Set(['class']),
  pre: new Set(['class']),
};

// Only these URL schemes ever survive on an href — closes off javascript:/data:/vbscript: and
// any other executable-content scheme. A relative URL (no scheme at all) is allowed.
const ALLOWED_HREF_SCHEMES = ['http', 'https', 'mailto'];
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

// Browsers strip ASCII tab/newline/CR (and ignore leading C0 controls and spaces) when parsing a
// URL, so `java<TAB>script:alert(1)` runs as javascript: even though a naive scheme regex sees
// no scheme at all. Every control/whitespace character is removed before the scheme is checked.
// eslint-disable-next-line no-control-regex
const URL_STRIPPED_CHARS = /[\u0000-\u0020\u007f-\u009f]/g;

export function isSafeHref(value: string): boolean {
  const trimmed = value.replace(URL_STRIPPED_CHARS, '');
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('//')) return false; // protocol-relative — ambiguous, treated as unsafe
  const match = SCHEME_PATTERN.exec(trimmed);
  if (!match) return true; // no scheme — a relative path/fragment
  return ALLOWED_HREF_SCHEMES.includes(match[1]!.toLowerCase());
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Parses `key="value"` / `key='value'` / `key=value` / bare `key` pairs out of a tag's raw
// attribute substring (already isolated from the surrounding `<tag ... >` by the tokenizer
// below, which itself is quote-aware so this substring never contains an unescaped `>`).
export function parseAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const name = match[1]!.toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs.set(name, value);
  }
  return attrs;
}

export interface TagToken {
  type: 'tag';
  closing: boolean;
  tagName: string;
  rawAttributes: string;
}

export interface TextToken {
  type: 'text';
  value: string;
}

// Quote-aware: scans for the next `>` that isn't inside a single- or double-quoted attribute
// value, so a value like `title=">"` can never prematurely end the tag (and can't be abused to
// smuggle a second, unsanitized tag past the parser).
export function tokenize(html: string): (TagToken | TextToken)[] {
  const tokens: (TagToken | TextToken)[] = [];
  let i = 0;
  let textStart = 0;
  // Total characters the tag scanner may examine across the whole input. A well-formed document
  // scans each character about once (<= html.length), so this never affects real content; it
  // only stops adversarial input (thousands of unterminated `<a "` fragments, each of which would
  // otherwise rescan to the end of the string — quadratic time, measured at ~60s for 100KB).
  // When exhausted, the rest of the input is treated as plain text, which the caller escapes.
  let scanBudget = 2_000_000;
  // `-->` missing from position i means it is missing from every later position too.
  let noCommentEnd = false;

  while (i < html.length) {
    if (html[i] !== '<') {
      i++;
      continue;
    }

    // Only `<` followed by a letter, `/`, `!` or `?` can start anything tag-like; otherwise (`<<`,
    // `< b`, `<3`) it is plain text and needs no scanning at all.
    const next = html[i + 1];
    if (next === undefined || !/[a-zA-Z/!?]/.test(next)) {
      i++;
      continue;
    }

    // A real comment ends at `-->` (not the first `>`), so a `>` or a tag-looking string inside
    // it can never leak out as text or start a tag.
    if (!noCommentEnd && html.startsWith('<!--', i)) {
      const commentEnd = html.indexOf('-->', i + 4);
      if (commentEnd >= 0) {
        if (textStart < i) tokens.push({ type: 'text', value: html.slice(textStart, i) });
        i = commentEnd + 3;
        textStart = i;
        continue;
      }
      noCommentEnd = true;
    }

    const tagStart = i;
    let j = i + 1;
    let quote: '"' | "'" | null = null;
    while (j < html.length) {
      if (--scanBudget < 0) {
        // Budget exhausted: everything from here on is text.
        if (textStart < html.length) tokens.push({ type: 'text', value: html.slice(textStart) });
        return tokens;
      }
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }

    if (j >= html.length) {
      // No matching unquoted `>` for the rest of the string — not a real tag; treat the `<`
      // itself as text (it will be escaped) and keep scanning.
      i++;
      continue;
    }

    const inner = html.slice(tagStart + 1, j); // between < and >, exclusive
    const closing = inner.startsWith('/');
    // No whitespace allowed between `<` and the name — browsers treat "< b>" as text, not a tag.
    const nameMatch = /^\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(inner);
    if (!nameMatch && !/^[!?]/.test(inner)) {
      // Not a tag at all (e.g. "a < b > c"): the `<` is ordinary text, escaped by the caller.
      i++;
      continue;
    }

    if (textStart < tagStart) {
      tokens.push({ type: 'text', value: html.slice(textStart, tagStart) });
    }

    if (!nameMatch) {
      // A doctype / processing instruction / bogus comment (`<!...>`, `<?...>`) — dropped whole.
      textStart = j + 1;
      i = j + 1;
      continue;
    }
    const tagName = nameMatch[1]!.toLowerCase();
    const rawAttributes = closing ? '' : inner.slice(nameMatch[0].length).replace(/\/\s*$/, '');
    tokens.push({ type: 'tag', closing, tagName, rawAttributes });

    textStart = j + 1;
    i = j + 1;
  }

  if (textStart < html.length) {
    tokens.push({ type: 'text', value: html.slice(textStart) });
  }

  return tokens;
}

export function sanitizeReplyHtml(html: string): string {
  const tokens = tokenize(html);
  let output = '';

  for (const token of tokens) {
    if (token.type === 'text') {
      output += escapeText(token.value);
      continue;
    }

    if (!ALLOWED_TAGS.has(token.tagName)) {
      // Drop just this tag token, never its surrounding content — the content (including a
      // disallowed element's own child text, e.g. `<script>alert(1)</script>`) is still
      // processed as ordinary text by later tokens and HTML-escaped above, so it can never
      // execute or reconstruct markup.
      continue;
    }

    if (token.closing) {
      output += `</${token.tagName}>`;
      continue;
    }

    const allowedForTag = ALLOWED_ATTRIBUTES[token.tagName];
    if (!allowedForTag) {
      output += `<${token.tagName}>`;
      continue;
    }

    const parsed = parseAttributes(token.rawAttributes);
    const kept: string[] = [];
    for (const attrName of allowedForTag) {
      const value = parsed.get(attrName);
      if (value === undefined) continue;
      if (attrName === 'href' && !isSafeHref(value)) continue;
      if (attrName === 'target' && value !== '_blank') continue;
      kept.push(`${attrName}="${escapeAttributeValue(value)}"`);
    }
    // A safe, non-exploitable default whenever a kept `target="_blank"` link opens — prevents
    // the opened page from getting a `window.opener` reference back to this one.
    if (kept.some((attr) => attr.startsWith('target='))) {
      kept.push('rel="noopener noreferrer"');
    }
    output += kept.length > 0 ? `<${token.tagName} ${kept.join(' ')}>` : `<${token.tagName}>`;
  }

  return output;
}
