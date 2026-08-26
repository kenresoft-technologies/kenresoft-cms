import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared base: JS + TS recommended rules, scoped explicitly to .ts/.tsx so plain config files aren't dragged in unexpectedly. */
export const base = tseslint.config(
  {
    ignores: ['**/dist/**', '**/.wrangler/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
