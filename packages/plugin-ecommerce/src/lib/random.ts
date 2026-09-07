import { createRandomStringGenerator } from '@better-auth/utils/random';

// Mirrors better-auth/crypto's own generateRandomString exactly (same alphabets, same
// rejection-sampling implementation over crypto.getRandomValues) — built on @better-auth/utils
// directly rather than the full better-auth package. better-auth itself would work too (it's
// what apps/api's own recovery-codes.ts/password-reset.ts already import this from), but adding
// it as a dependency here pulls in @better-auth/core/better-call/zod as real, resolved
// dependencies purely from being listed — even though only this one pure function is used — and
// that shifted pnpm's shared peer-resolution for every OTHER better-auth consumer in the
// workspace (including apps/admin's own, unrelated CMS-staff auth client) onto a different zod
// version, breaking its typecheck. @better-auth/utils has no such dependency at all.
export const generateRandomString = createRandomStringGenerator('a-z', '0-9', 'A-Z', '-_');
