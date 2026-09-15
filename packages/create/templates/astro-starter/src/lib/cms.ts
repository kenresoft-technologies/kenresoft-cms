import { createKenresoftClient } from '@kenresoft-cms/astro';

// One client, imported everywhere a page needs to read from your Kenresoft CMS deployment. Point
// PUBLIC_KENRESOFT_CMS_URL (.env) at your deployed API Worker's URL, or http://localhost:8787
// while running the CMS locally via `wrangler dev`.
export const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL });
