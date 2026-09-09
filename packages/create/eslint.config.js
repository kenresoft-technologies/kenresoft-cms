import globals from 'globals';

import { node } from '@kenresoft-cms/config/eslint/node';

export default [
  ...node,
  // The `node` shared config assumes the Cloudflare Workers runtime (apps/api, packages/*) and
  // gives it `globals.worker` — this package's bin script is a plain Node CLI (`process`, `fetch`
  // as a Node global, etc.), which needs `globals.node` instead.
  {
    files: ['bin/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
