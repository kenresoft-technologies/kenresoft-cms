// Builds a Live Preview URL from an operator-configured template plus placeholder values,
// then collapses any accidental double slash the substitution can produce — e.g. a Page's
// `route` already starts with "/" (`/about`), so a template written as
// "https://example.com/{route}" (a natural thing to type, mirroring the entry template's own
// "/{contentType}/{slug}" shape) would otherwise silently produce "https://example.com//about"
// and 404 on the frontend. The collapse skips the scheme separator ("https://") so it never
// touches that intentional double slash.
export function buildPreviewUrl(template: string, replacements: Record<string, string>): string {
  let url = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    url = url.replaceAll(`{${placeholder}}`, value);
  }
  return url.replace(/([^:])\/{2,}/g, '$1/');
}
