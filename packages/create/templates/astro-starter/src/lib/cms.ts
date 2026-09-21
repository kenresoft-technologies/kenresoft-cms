import { createKenresoftClient } from '@kenresoft-cms/astro';

const url = import.meta.env.PUBLIC_KENRESOFT_CMS_URL;

// One client, imported everywhere a page needs to read PUBLIC content from your Kenresoft CMS
// deployment. Point PUBLIC_KENRESOFT_CMS_URL (.env) at your deployed API Worker's URL, or
// http://localhost:8787 while running the CMS locally via `wrangler dev`.
export const cms = createKenresoftClient({ url });

// For server-rendered pages that need to know WHO is signed in (e.g. src/pages/account/index.astro):
// forwards the visitor's own cookie to the API. The session cookie is first-party to this site
// because the browser talks to the API through the /cms proxy (src/pages/cms/[...path].ts).
export function cmsForRequest(request: Request) {
  return createKenresoftClient({ url, cookies: request.headers.get('cookie') });
}
