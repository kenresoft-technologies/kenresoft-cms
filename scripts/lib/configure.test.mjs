import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configureDomain, describeDomain, resolveInput } from './configure.mjs';
import { readCustomDomainRoutes, readWorkersDevEnabled } from './wrangler-toml.mjs';

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

// Direct regression test: confirmed empirically against a real deploy that wrangler's own default
// for an absent `workers_dev` flips to *disabled* the moment any `[[routes]]` entry exists (the
// docs claim it defaults to enabled unconditionally — only true before a route exists). A first
// version of configureDomain's CI path only wrote `workers_dev = false` when explicitly asked to
// disable it, silently leaving it implicit — and therefore disabled — otherwise. It must always
// write the field explicitly once a route is added.
test('configureDomain (CI): adding a domain without asking to disable workers.dev leaves it explicitly true, not implicit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-configure-domain-'));
  const path = join(dir, 'wrangler.toml');
  writeFileSync(path, 'name = "test-worker"\ncompatibility_date = "2026-01-01"\n\n[vars]\nCORS_ORIGINS = "http://localhost:5173"\n');
  try {
    const result = await configureDomain({
      wranglerTomlPath: path,
      apiDir: dir,
      status: { domain: { customDomains: [], workersDevEnabled: true } },
      ci: true,
      env: { CUSTOM_DOMAIN_NEW: 'api.example.com' },
    });
    assert.deepEqual(result, { changed: true, redeployNeeded: true });
    const toml = readFileSync(path, 'utf8');
    assert.deepEqual(readCustomDomainRoutes(toml), ['api.example.com']);
    assert.equal(readWorkersDevEnabled(toml), true, 'must be explicitly true, not merely absent');
    assert.match(toml, /^workers_dev\s*=\s*true$/m, 'the field itself must actually be written, not just read as true by default');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureDomain (CI): DISABLE_WORKERS_DEV=true explicitly disables it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-configure-domain-'));
  const path = join(dir, 'wrangler.toml');
  writeFileSync(path, 'name = "test-worker"\ncompatibility_date = "2026-01-01"\n\n[vars]\nCORS_ORIGINS = "http://localhost:5173"\n');
  try {
    await configureDomain({
      wranglerTomlPath: path,
      apiDir: dir,
      status: { domain: { customDomains: [], workersDevEnabled: true } },
      ci: true,
      env: { CUSTOM_DOMAIN_NEW: 'api.example.com', DISABLE_WORKERS_DEV: 'true' },
    });
    assert.equal(readWorkersDevEnabled(readFileSync(path, 'utf8')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describeDomain reports both the connected domain(s) and workers.dev state', () => {
  assert.equal(
    describeDomain({ domain: { customDomains: [], workersDevEnabled: true } }),
    'custom domain(s): none, workers.dev: enabled',
  );
  assert.equal(
    describeDomain({ domain: { customDomains: ['api.example.com'], workersDevEnabled: false } }),
    'custom domain(s): api.example.com, workers.dev: disabled',
  );
});
