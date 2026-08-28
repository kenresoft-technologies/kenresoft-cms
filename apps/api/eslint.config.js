import { node } from '@kenresoft/config/eslint/node';

export default [
  ...node,
  // scripts/ runs under plain Node (operator-invoked CLI tools like recover-owner.mjs), not
  // the Cloudflare Workers runtime the rest of this package targets — @kenresoft/config's
  // "node" preset is actually Workers globals (see its own file for why), so this package's
  // one Node-only directory needs its own override rather than widening that shared preset or
  // adding a `globals` devDependency just for this one file's `process` reference.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
];
