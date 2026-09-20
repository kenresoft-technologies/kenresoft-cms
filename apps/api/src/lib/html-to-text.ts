// A minimal, dependency-free HTML->plain-text conversion for the plain-text part of an email
// whose primary content is HTML (form-submission-replies.ts's rich-text compose box). Not a
// general-purpose renderer, just enough structure (paragraph/line breaks, list items) to read
// sensibly in a plain-text mail client. Deliberately not pulling in turndown (the admin-only
// HTML<->Markdown converter used by the entry editor's Markdown mode) as a new apps/api
// dependency for this one, much smaller need.

// Removes tags until none are left, so input like `<<b>script>` can't reassemble into a tag.
export function stripTags(html: string): string {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current;
}

export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<(p|div|h[1-6]|li|tr)[^>]*>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  // &amp; is decoded last so `&amp;lt;` becomes the literal text `&lt;`, not `<`.
  return stripTags(withBreaks)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
