import { createKenresoftClient, KenresoftApiError } from '@kenresoft-cms/astro';

// The client for code that runs in the visitor's BROWSER (login, register, sign-out, ...). It talks
// to this site's own /cms proxy rather than the API directly, so the session cookie is first-party
// and works even in browsers that block cross-site cookies (Safari, Firefox with blocking on).
export const browserCms = createKenresoftClient({ url: '/cms' });
export { KenresoftApiError };
