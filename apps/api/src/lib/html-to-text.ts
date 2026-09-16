// A minimal, dependency-free HTML->plain-text conversion for the plain-text part of an email
// whose primary content is HTML (form-submission-replies.ts's rich-text compose box) — not a
// general-purpose renderer, just enough structure (paragraph/line breaks, list items) to read
// sensibly in a plain-text mail client. Deliberately not pulling in turndown (the admin-only
// HTML<->Markdown converter used by the entry editor's Markdown mode) as a new apps/api
// dependency for this one, much smaller need.
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(p|div|h[1-6]|li|tr)[^>]*>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
