/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_KENRESOFT_CMS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
