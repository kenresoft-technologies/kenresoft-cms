import { htmlToPlainText } from '../html-to-text';
import { sanitizeEmailHtml } from '../raw-html-sanitizer';

// A flat, dot-path variable map (e.g. { 'user.name': 'Jane', 'design.brandColor': '#4f46e5' }) —
// never an object tree and never evaluated as code. `{{path}}` substitution is a single regex
// replace against this map's own keys; an unrecognized `{{...}}` token in the source is left
// exactly as-is (not blanked, not thrown on) so a typo is visibly wrong in the rendered output
// rather than silently disappearing — the admin preview is what catches it before a real send.
export type TemplateVariables = Record<string, string>;

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

// HTML-escaped substitution for the subject line and the HTML body — every variable value is
// untrusted (a user's own `name`, a support email an admin typed into Settings, ...), so it is
// always escaped before insertion, the same discipline as substituting into any other HTML
// document. This is the *entire* templating engine: no expressions, no function calls, no
// includes/partials — a `{{path}}` token is a dictionary lookup and nothing else, which is what
// makes "never supports arbitrary code" a property of the implementation, not just a rule
// someone has to remember to follow.
// Exported for standard-render.ts, which escapes admin-supplied structured content (heading,
// body text, CTA label, fine print) before splicing it directly into a design's generated
// bodyHtml — the same discipline this file already applies to every `{{token}}` substitution,
// just needed one step earlier since structured content isn't itself a token.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function substitute(template: string, variables: TemplateVariables, escape: (value: string) => string): string {
  return template.replace(TOKEN_PATTERN, (match, path: string) => {
    const value = variables[path];
    return value === undefined ? match : escape(value);
  });
}

export interface RenderedEmailTemplate {
  subject: string;
  html: string;
  text: string;
}

// The one rendering path every send/preview call goes through — subject and HTML both get
// escaped substitution, the resulting HTML is always re-sanitized (sanitizeEmailHtml) even
// though only admins can edit a template, matching this codebase's "the output is delivered to
// people outside this deployment, so it must be safe even if an admin account is compromised"
// stance already documented on raw-html-sanitizer.ts — and the plain-text part either comes
// from an explicit stored override or is derived from the (already-substituted, pre-sanitize)
// HTML, never the raw stored template, so a plain-text client never sees a literal
// `{{unrendered.token}}`.
export function renderEmailTemplate(
  template: { subject: string; bodyHtml: string; plainText: string | null },
  variables: TemplateVariables,
): RenderedEmailTemplate {
  const subject = substitute(template.subject, variables, escapeHtml).trim();
  const substitutedHtml = substitute(template.bodyHtml, variables, escapeHtml);
  const html = sanitizeEmailHtml(substitutedHtml);
  const text =
    template.plainText !== null
      ? substitute(template.plainText, variables, (v) => v)
      : htmlToPlainText(substitutedHtml);
  return { subject, html, text };
}
