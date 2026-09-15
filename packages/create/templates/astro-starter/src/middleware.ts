import { defineMiddleware } from 'astro:middleware';
import { createKenresoftClient, getPreviewToken } from '@kenresoft-cms/astro';

// One client per request, bound to this request's own Live Preview token (a no-op default on a
// normal request — getPreviewToken() returns null when ?preview_token= is absent). Shared via
// Astro.locals.cms so every page's entries.get()/pages.resolve() call gets Live Preview
// automatically, with no ?preview_token= handling of its own — see blog/[slug].astro.
//
// lib/cms.ts's shared singleton client still exists separately for the common, non-preview case
// (list pages, and the contact form's client-side submission, which runs in the browser and has
// no access to Astro.locals at all) — this per-request client is specifically for pages that
// render a single entry/Page and want Live Preview to work.
export const onRequest = defineMiddleware((context, next) => {
  context.locals.cms = createKenresoftClient({
    url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL,
    previewToken: getPreviewToken(context.url),
  });
  return next();
});
