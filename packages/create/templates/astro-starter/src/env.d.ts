/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_KENRESOFT_CMS_URL: string;
  /** Optional: a Cloudflare Turnstile site key. Set it (and TURNSTILE_SECRET_KEY on the API) to require a human check on register. */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The Workers runtime env (bindings, vars, secrets), importable at request time.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
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
