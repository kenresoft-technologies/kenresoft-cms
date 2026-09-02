import globals from 'globals';

import { react } from '@kenresoft/config/eslint/react';

export default [
  ...react,
  // Node-context scripts (build tooling, E2E harness) — not the browser app itself, which is
  // why the shared react config's globals.browser doesn't cover them.
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
