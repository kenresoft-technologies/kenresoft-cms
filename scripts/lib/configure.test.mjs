import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  configureAdminDomain,
  configureDomain,
  configureTurnstile,
  describeDomain,
  describeTurnstile,
  normalizeAdminDomain,
  planAdminDomainCorsUpdate,
  resolveInput,
} from './configure.mjs';
import { readCorsOrigins, readCustomDomainRoutes, readVarLine, readWorkersDevEnabled, setVarLine } from './wrangler-toml.mjs';

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

test('describeTurnstile reports configured/not-configured, and the site key (not a secret value)', () => {
  assert.equal(describeTurnstile({ turnstile: { configured: false, siteKey: null } }), 'not configured');
  assert.equal(
    describeTurnstile({ turnstile: { configured: true, siteKey: null } }),
    'configured (public sign-up requires a human check), site key: not set',
  );
  assert.equal(
    describeTurnstile({ turnstile: { configured: true, siteKey: '0x4AAA...' } }),
    'configured (public sign-up requires a human check), site key: 0x4AAA...',
  );
});

// Direct regression test for a real, reported bug: a deployer ran `pnpm run update -- --turnstile`,
// the CLI said "took effect immediately, no redeploy needed," but GET /api/v1/system/status kept
// showing the site key as unset — because a wrangler.toml var (unlike a secret, which
// `wrangler secret put` applies to the live Worker right away) does nothing to the deployed
// Worker until the next `wrangler deploy`. Only exercises the site-key-only path (no
// TURNSTILE_SECRET_KEY_NEW), since a secret change would need a real `wrangler secret put`
// invocation this test suite has no way to stub — same accepted gap as configureEmail's
// RESEND_API_KEY path.
test('configureTurnstile (CI): a site-key-only change must redeploy — it is a var, not a secret', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-configure-turnstile-'));
  const path = join(dir, 'wrangler.toml');
  writeFileSync(path, 'name = "test-worker"\ncompatibility_date = "2026-01-01"\n\n[vars]\nCORS_ORIGINS = "http://localhost:5173"\n');
  try {
    const result = await configureTurnstile({
      wranglerTomlPath: path,
      apiDir: dir,
      status: { turnstile: { configured: true, siteKey: null } },
      ci: true,
      env: { TURNSTILE_SITE_KEY_NEW: '0x4AAAAAAAtest' },
    });
    assert.deepEqual(result, { changed: true, redeployNeeded: true }, 'a site-key-only change must report redeployNeeded: true');
    assert.equal(readVarLine(readFileSync(path, 'utf8'), 'TURNSTILE_SITE_KEY'), '0x4AAAAAAAtest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureTurnstile (CI): no TURNSTILE_*_NEW and no TURNSTILE_DISABLE leaves everything unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-configure-turnstile-'));
  const path = join(dir, 'wrangler.toml');
  writeFileSync(path, 'name = "test-worker"\ncompatibility_date = "2026-01-01"\n\n[vars]\nCORS_ORIGINS = "http://localhost:5173"\n');
  try {
    const result = await configureTurnstile({
      wranglerTomlPath: path,
      apiDir: dir,
      status: { turnstile: { configured: false, siteKey: null } },
      ci: true,
      env: {},
    });
    assert.deepEqual(result, { changed: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- configureAdminDomain ----
//
// Real production migration this backs: moving the Admin app's own custom domain (e.g.
// cms.example.com -> admin.example.com) while keeping ADMIN_URL/CORS_ORIGINS in sync and never
// touching BETTER_AUTH_URL. deployAdmin/deployApiFn/putSecret are injected fakes — this never
// shells out to a real wrangler binary, matching every other unit test in this suite.

const ADMIN_TOML = 'name = "kenresoft-cms-admin"\ncompatibility_date = "2026-09-02"\n\n[assets]\ndirectory = "./dist"\n';
const API_TOML_WITH_CORS = (cors) =>
  `name = "kenresoft-cms-api"\ncompatibility_date = "2026-01-01"\n\n[vars]\nCORS_ORIGINS = "${cors}"\nBETTER_AUTH_URL = "https://api.example.com"\n`;

function writeAdminDomainFixtures({ adminToml = ADMIN_TOML, apiCors = 'https://cms.example.com,https://example.com' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-configure-admin-domain-'));
  const adminPath = join(dir, 'admin-wrangler.toml');
  const apiPath = join(dir, 'wrangler.toml');
  writeFileSync(adminPath, adminToml);
  writeFileSync(apiPath, API_TOML_WITH_CORS(apiCors));
  return { dir, adminPath, apiPath };
}

function fakeDeployAdmin(urls = ['https://kenresoft-cms-admin.example.workers.dev']) {
  const calls = [];
  let i = 0;
  const fn = () => {
    calls.push(true);
    return urls[Math.min(i++, urls.length - 1)];
  };
  fn.calls = calls;
  return fn;
}

test('normalizeAdminDomain strips protocol, trailing slashes, and lowercases', () => {
  assert.equal(normalizeAdminDomain('https://Admin.Example.com/'), 'admin.example.com');
  assert.equal(normalizeAdminDomain('admin.example.com'), 'admin.example.com');
  assert.equal(normalizeAdminDomain('  http://admin.example.com  '), 'admin.example.com');
});

test('planAdminDomainCorsUpdate: replaces the old admin origin, preserving unrelated origins', () => {
  const { toml } = planAdminDomainCorsUpdate(API_TOML_WITH_CORS('https://cms.example.com,https://example.com'), 'https://cms.example.com', 'https://admin.example.com');
  assert.deepEqual(readCorsOrigins(toml), ['https://admin.example.com', 'https://example.com']);
});

test('configureAdminDomain (CI): migrates a domain end to end — Admin route, ADMIN_URL, and CORS all updated; BETTER_AUTH_URL untouched', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures({
    adminToml: addCustomDomainRouteFixture(ADMIN_TOML, 'cms.example.com'),
  });
  const secretCalls = [];
  try {
    const result = await configureAdminDomain({
      adminWranglerTomlPath: adminPath,
      adminDir: dir,
      apiWranglerTomlPath: apiPath,
      apiDir: dir,
      ci: true,
      env: { ADMIN_CUSTOM_DOMAIN_NEW: 'admin.example.com' },
      deployAdmin: fakeDeployAdmin(),
      deployApiFn: () => 'https://api.example.com',
      putSecret: (name, value) => secretCalls.push({ name, value }),
    });
    assert.equal(result.changed, true);

    // 1. Admin custom domain migrated (old route in this test is already the pre-existing one —
    // see the note below; the new one must be present).
    assert.deepEqual(readCustomDomainRoutes(readFileSync(adminPath, 'utf8')), ['cms.example.com', 'admin.example.com']);

    // 2. ADMIN_URL secret updated to the new domain.
    assert.deepEqual(secretCalls, [{ name: 'ADMIN_URL', value: 'https://admin.example.com' }]);

    // 3. CORS_ORIGINS migrated: new origin added, old one removed, unrelated origin preserved.
    const apiToml = readFileSync(apiPath, 'utf8');
    assert.deepEqual(readCorsOrigins(apiToml), ['https://admin.example.com', 'https://example.com']);

    // 4. BETTER_AUTH_URL is a completely separate concept and must never be touched by this.
    assert.equal(readVarLine(apiToml, 'BETTER_AUTH_URL'), 'https://api.example.com');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureAdminDomain (CI): duplicate prevention — the new origin already present is not duplicated', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures({
    adminToml: addCustomDomainRouteFixture(ADMIN_TOML, 'cms.example.com'),
    apiCors: 'https://admin.example.com,https://example.com',
  });
  try {
    await configureAdminDomain({
      adminWranglerTomlPath: adminPath,
      adminDir: dir,
      apiWranglerTomlPath: apiPath,
      apiDir: dir,
      ci: true,
      env: { ADMIN_CUSTOM_DOMAIN_NEW: 'admin.example.com' },
      deployAdmin: fakeDeployAdmin(),
      deployApiFn: () => 'https://api.example.com',
      putSecret: () => {},
    });
    const apiToml = readFileSync(apiPath, 'utf8');
    assert.deepEqual(readCorsOrigins(apiToml), ['https://admin.example.com', 'https://example.com']);
    assert.equal((apiToml.match(/https:\/\/admin\.example\.com/g) ?? []).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureAdminDomain (CI): idempotent — running the migration twice makes no further changes on the second run', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures({
    adminToml: addCustomDomainRouteFixture(ADMIN_TOML, 'cms.example.com'),
  });
  try {
    const args = {
      adminWranglerTomlPath: adminPath,
      adminDir: dir,
      apiWranglerTomlPath: apiPath,
      apiDir: dir,
      ci: true,
      env: { ADMIN_CUSTOM_DOMAIN_NEW: 'admin.example.com' },
      deployAdmin: fakeDeployAdmin(),
      deployApiFn: () => 'https://api.example.com',
      putSecret: () => {},
    };
    await configureAdminDomain(args);
    const afterFirst = readFileSync(apiPath, 'utf8');

    const second = await configureAdminDomain(args);
    const afterSecond = readFileSync(apiPath, 'utf8');
    assert.equal(afterSecond, afterFirst, 'a second run must not change CORS_ORIGINS further');
    assert.equal(second.apiRedeployed, false, 'no CORS change on the second run means no redeploy either');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureAdminDomain (CI): ADMIN_CUSTOM_DOMAIN_NEW unset leaves everything unchanged', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures();
  try {
    const result = await configureAdminDomain({
      adminWranglerTomlPath: adminPath,
      adminDir: dir,
      apiWranglerTomlPath: apiPath,
      apiDir: dir,
      ci: true,
      env: {},
      deployAdmin: fakeDeployAdmin(),
      deployApiFn: () => 'https://api.example.com',
      putSecret: () => assert.fail('putSecret must not be called when no domain is requested'),
    });
    assert.deepEqual(result, { changed: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureAdminDomain (CI): an Admin Worker deploy failure leaves CORS_ORIGINS/ADMIN_URL/route completely untouched', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures();
  const apiTomlBefore = readFileSync(apiPath, 'utf8');
  try {
    await assert.rejects(
      configureAdminDomain({
        adminWranglerTomlPath: adminPath,
        adminDir: dir,
        apiWranglerTomlPath: apiPath,
        apiDir: dir,
        ci: true,
        env: { ADMIN_CUSTOM_DOMAIN_NEW: 'admin.example.com' },
        deployAdmin: () => {
          throw new Error('simulated deploy failure');
        },
        deployApiFn: () => assert.fail('the API must never be touched when the Admin deploy fails'),
        putSecret: () => assert.fail('ADMIN_URL must never be updated when the Admin deploy fails'),
      }),
      /simulated deploy failure/,
    );
    // CORS_ORIGINS is completely unchanged — no partial migration.
    assert.equal(readFileSync(apiPath, 'utf8'), apiTomlBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureAdminDomain (CI): a failed API redeploy is reported as incomplete, not a success — Admin domain stays live', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures();
  try {
    await assert.rejects(
      configureAdminDomain({
        adminWranglerTomlPath: adminPath,
        adminDir: dir,
        apiWranglerTomlPath: apiPath,
        apiDir: dir,
        ci: true,
        env: { ADMIN_CUSTOM_DOMAIN_NEW: 'admin.example.com' },
        deployAdmin: fakeDeployAdmin(),
        putSecret: () => {},
        deployApiFn: () => {
          throw new Error('simulated API deploy failure');
        },
      }),
      /Admin domain migration incomplete/,
    );
    // The Admin Worker's own route change is real and stays in place — it genuinely deployed.
    assert.deepEqual(readCustomDomainRoutes(readFileSync(adminPath, 'utf8')), ['admin.example.com']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configureAdminDomain (CI) and configureAdminDomain via env produce the same CORS outcome as the direct pure planner', async () => {
  const { dir, adminPath, apiPath } = writeAdminDomainFixtures({
    adminToml: addCustomDomainRouteFixture(ADMIN_TOML, 'cms.example.com'),
  });
  try {
    await configureAdminDomain({
      adminWranglerTomlPath: adminPath,
      adminDir: dir,
      apiWranglerTomlPath: apiPath,
      apiDir: dir,
      ci: true,
      env: { ADMIN_CUSTOM_DOMAIN_NEW: 'admin.example.com' },
      deployAdmin: fakeDeployAdmin(),
      deployApiFn: () => 'https://api.example.com',
      putSecret: () => {},
    });
    const viaCi = readCorsOrigins(readFileSync(apiPath, 'utf8'));

    const { toml: viaPlanner } = planAdminDomainCorsUpdate(API_TOML_WITH_CORS('https://cms.example.com,https://example.com'), 'https://cms.example.com', 'https://admin.example.com');
    assert.deepEqual(viaCi, readCorsOrigins(viaPlanner));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Minimal local helper mirroring addCustomDomainRoute's own on-disk shape, used only to seed an
// admin wrangler.toml fixture that already has an existing custom domain (so oldAdminOrigin is
// derived from it directly rather than needing a fake deploy for that step too).
function addCustomDomainRouteFixture(toml, pattern) {
  return toml.replace(/\n*$/, '') + `\n\n[[routes]]\npattern = "${pattern}"\ncustom_domain = true\n`;
}

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
