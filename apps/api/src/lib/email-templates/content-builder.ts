import { escapeHtml } from './render';

// Every paragraph (including the fixed greeting) gets the same look; only the very last one
// drops the bottom margin, matching the original hand-written two-paragraph default's own
// spacing exactly.
function paragraphHtml(text: string, isLast: boolean): string {
  const margin = isLast ? '0' : '0 0 8px 0';
  return `<p style="margin:${margin}; font-size:15px; line-height:1.6; color:{{design.textColor}};">${escapeHtml(text).replace(/\n/g, '<br />')}</p>`;
}

// Builds the bodyParagraphsHtml every design (designs.ts) renders inside its content area: a
// fixed greeting line — using the real `{{user.name}}` token, never admin-edited, so Standard
// mode never has to expose `{{}}` syntax to a non-technical admin — followed by the admin's own
// body text, escaped and split into paragraphs on blank lines. Shared by both the shipped
// defaults (defaults.ts) and a real admin edit (standard-render.ts), so they go through exactly
// the same transform and can never visually diverge from each other.
export function buildBodyParagraphsHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const all = ['Hi {{user.name}},', ...paragraphs];
  return all.map((text, index) => paragraphHtml(text, index === all.length - 1)).join('\n              ');
}
