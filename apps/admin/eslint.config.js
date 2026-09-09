import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Inlined from @kenresoft-cms/config/eslint/{base,react} rather than depended on: apps/admin must
// stay installable as a standalone clone (its own README documents why — a subdirectory-scoped
// "Deploy to Cloudflare" button isolates this directory as the entirety of a new repo, where a
// workspace:* devDependency can't resolve at all). This duplicates the monorepo's shared ESLint
// rules; if those change, mirror the change here too.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.wrangler/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Node-context scripts (build tooling, E2E harness) — not the browser app itself, which is
  // why the globals.browser block above doesn't cover them.
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
