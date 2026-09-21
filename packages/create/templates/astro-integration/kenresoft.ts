import { createKenresoftClient, KenresoftApiError } from '@kenresoft-cms/astro';

const url = import.meta.env.PUBLIC_KENRESOFT_CMS_URL;

// Server-side client for reading PUBLIC content in your pages (frontmatter / endpoints).
export const cms = createKenresoftClient({ url });

// Server-side client that also knows WHO is signed in: forwards the visitor's own cookie to the
// API. The cookie is first-party to your site because the browser talks to the API through the
// /cms proxy (src/pages/cms/[...path].ts).
export function cmsForRequest(request: Request) {
  return createKenresoftClient({ url, cookies: request.headers.get('cookie') });
}

// Client for code that runs in the visitor's BROWSER (sign in, sign up, sign out, ...). Talks to
// this site's own /cms proxy rather than the API directly.
export const browserCms = createKenresoftClient({ url: '/cms' });
export { KenresoftApiError };
