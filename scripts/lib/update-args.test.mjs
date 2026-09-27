import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUpdateArgs } from './update-args.mjs';

test('bare invocation: no category, no branch override, not ci', () => {
  assert.deepEqual(parseUpdateArgs([], {}), { ci: false, branch: null, version: null, category: null });
});

test('a single category flag is picked up', () => {
  assert.deepEqual(parseUpdateArgs(['--auth'], {}), { ci: false, branch: null, version: null, category: 'auth' });
  assert.deepEqual(parseUpdateArgs(['--email', '--ci'], {}), { ci: true, branch: null, version: null, category: 'email' });
  assert.deepEqual(parseUpdateArgs(['--turnstile'], {}), { ci: false, branch: null, version: null, category: 'turnstile' });
});

test('two category flags at once is rejected', () => {
  assert.throws(() => parseUpdateArgs(['--auth', '--email'], {}), /only one of/i);
});

test('--branch <name> and --branch=<name> both work', () => {
  assert.equal(parseUpdateArgs(['--branch', 'develop'], {}).branch, 'develop');
  assert.equal(parseUpdateArgs(['--branch=main'], {}).branch, 'main');
});

test('--branch with no value is rejected', () => {
  assert.throws(() => parseUpdateArgs(['--branch'], {}), /requires a value/i);
});

// This is the actual feature the switchable-branch request needed: a test/staging deployment can
// set UPDATE_BRANCH once in its own shell/CI env instead of typing --branch on every invocation.
test('UPDATE_BRANCH env var is used when no --branch flag is given', () => {
  assert.equal(parseUpdateArgs([], { UPDATE_BRANCH: 'develop' }).branch, 'develop');
});

test('an explicit --branch flag wins over UPDATE_BRANCH', () => {
  assert.equal(parseUpdateArgs(['--branch', 'main'], { UPDATE_BRANCH: 'develop' }).branch, 'main');
});

test('--branch together with a category flag is rejected — branch only applies to the plain code pull', () => {
  assert.throws(() => parseUpdateArgs(['--auth', '--branch', 'develop'], {}), /only applies to the plain code-pull/i);
  assert.throws(() => parseUpdateArgs(['--email'], { UPDATE_BRANCH: 'develop' }), /only applies to the plain code-pull/i);
});

test('--version <x> and --version=<x> pin a release, and conflict with --branch and categories', () => {
  assert.equal(parseUpdateArgs(['--version', '0.9.1'], {}).version, '0.9.1');
  assert.equal(parseUpdateArgs(['--version=v0.9.1'], {}).version, 'v0.9.1');
  assert.equal(parseUpdateArgs([], {}).version, null);
  assert.throws(() => parseUpdateArgs(['--version'], {}), /requires a value/);
  assert.throws(() => parseUpdateArgs(['--version', '--ci'], {}), /requires a value/);
  assert.throws(() => parseUpdateArgs(['--version', '0.9.1', '--branch', 'develop'], {}), /can't be combined/);
  assert.throws(() => parseUpdateArgs(['--version', '0.9.1'], { UPDATE_BRANCH: 'develop' }), /UPDATE_BRANCH is set/);
  assert.throws(() => parseUpdateArgs(['--version', '0.9.1', '--email'], {}), /configuration change/);
});
