import { createKenresoftClient, KenresoftApiError, type KenresoftClient } from '@kenresoft-cms/astro';

// The browser-side counterpart to site-client.ts's SSR client — used from <script> tags for
// every mutation (login, register, add-to-cart, checkout, ...). Runs as a real fetch from the
// visitor's own browser, so cookies the API sets (guest cart id, customer session) land in the
// browser's normal cookie jar with no proxying needed — see site-client.ts's own comment for why
// SSR reads need that proxying and browser-side mutations don't.
let client: KenresoftClient | null = null;

export function getBrowserClient(): KenresoftClient {
  client ??= createKenresoftClient({ url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL });
  return client;
}

export { KenresoftApiError };
