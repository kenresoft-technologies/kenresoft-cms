import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveInput } from './configure.mjs';

// This is the single guard the reported bug ("skipping Resend can make it appear unconfigured")
// depends on: a blank secret-prompt answer (pressing Enter to mean "leave it as it is") must
// never be treated as "set the secret to this value" — that's exactly how RESEND_API_KEY was
// silently set to "" on a rerun, which reads as falsy everywhere the app checks it, making a
// correctly-configured deployment quietly regress to "email not configured".
test('resolveInput: blank input never counts as a real value', () => {
  assert.deepEqual(resolveInput(''), { changed: false });
  assert.deepEqual(resolveInput('   '), { changed: false });
  assert.deepEqual(resolveInput(undefined), { changed: false });
  assert.deepEqual(resolveInput(null), { changed: false });
});

test('resolveInput: a real value is trimmed and reported as a change', () => {
  assert.deepEqual(resolveInput('  re_abc123  '), { changed: true, value: 're_abc123' });
});

// Same guard, applied to CI/non-interactive mode: an omitted *_NEW environment variable must mean
// "leave unchanged", the same as a blank interactive answer — required by the task's own rule
// that "omitted CI variables must not reset existing values".
test('resolveInput: an unset CI env var (undefined) never counts as a real value', () => {
  const env = {};
  assert.deepEqual(resolveInput(env.BETTER_AUTH_URL_NEW), { changed: false });
});
