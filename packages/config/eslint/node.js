import globals from 'globals';

import { base } from './base.js';

/** For apps/api and packages/* — Cloudflare Workers runtime, no browser/react globals. */
export const node = [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },
];
