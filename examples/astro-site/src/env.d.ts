/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_KENRESOFT_CMS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The Workers runtime env (bindings, vars, secrets), importable at request time. Declared minimally
// here since this example carries no @cloudflare/workers-types dependency of its own.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
