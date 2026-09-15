/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_KENRESOFT_CMS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /**
     * One client per request, already bound to this request's own Live Preview token (see
     * middleware.ts) — pages that need Live Preview (e.g. blog/[slug].astro) should read from
     * this instead of the shared `cms` in lib/cms.ts, so entries.get()/pages.resolve() calls
     * transparently render a draft with zero ?preview_token= handling of their own.
     */
    cms: ReturnType<typeof import('@kenresoft-cms/astro').createKenresoftClient>;
  }
}
