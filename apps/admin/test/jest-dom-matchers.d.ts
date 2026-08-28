// @testing-library/jest-dom's own bundled `vitest.d.ts` augments `declare module 'vitest'` via
// a bare `import 'vitest'` inside *its own* file, deep in node_modules — which resolves
// ambiguously in this monorepo, where apps/api pins vitest 3.x (@cloudflare/vitest-pool-workers's
// constraint) and apps/admin pins 4.x, and jest-dom itself declares no `peerDependencies` on
// vitest at all for pnpm to disambiguate by. That resolved fine on a Windows local install but
// failed on a fresh Linux CI install — same lockfile, same versions, different hoisting outcome
// (confirmed: every `expect(...).toBeInTheDocument()`-style call in apps/admin failed to
// typecheck in CI with "Property does not exist on type Assertion", passing locally throughout).
//
// This file sidesteps that ambiguity entirely: `import 'vitest'` here resolves from *this*
// file's own location, inside apps/admin's own tree, which only ever sees apps/admin's pinned
// vitest — no cross-package ambiguity possible. Covers exactly the matchers this test suite
// actually uses (see `grep -rohE '\.(toBe...|toHave...)\(' test/*.tsx`); add more here if a new
// matcher gets used and TypeScript complains it's missing.
import 'vitest';

interface JestDomMatchers<R = void> {
  toBeInTheDocument(): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toBeChecked(): R;
  toHaveAttribute(attr: string, value?: unknown): R;
  toHaveTextContent(text: string | RegExp, options?: { normalizeWhitespace?: boolean }): R;
  toHaveValue(value?: string | string[] | number): R;
}

declare module 'vitest' {
  // Both interfaces below are declaration merging (adding to vitest's real Assertion /
  // AsymmetricMatchersContaining), not genuinely empty types — eslint's static analysis can't
  // tell the difference. T mirrors vitest's own Assertion<T> signature; required for the merge
  // to apply, unused in this file's own body.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Assertion<T = unknown> extends JestDomMatchers<void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends JestDomMatchers<void> {}
}
