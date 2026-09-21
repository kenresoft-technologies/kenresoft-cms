import globals from 'globals';

import { node } from '@kenresoft-cms/config/eslint/node';

export default [
  // Templates are copied into other people's projects, not linted or compiled here.
  { ignores: ['templates/**'] },
  ...node,
  // The `node` shared config assumes the Cloudflare Workers runtime (apps/api, packages/*) and
  // gives it `globals.worker` — this package's bin script is a plain Node CLI (`process`, `fetch`
  // as a Node global, etc.), which needs `globals.node` instead.
  {
    files: ['bin/**/*.mjs', 'lib/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
