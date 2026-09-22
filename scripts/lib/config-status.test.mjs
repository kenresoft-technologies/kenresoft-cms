import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUTH_URL_PLACEHOLDER, classifyInstallStatus, isFreshInstall, isRealAuthUrl, parseLocalConfig, summarizeInstallStatus } from './config-status.mjs';

const BASE_TOML = `
name = "kenresoft-cms-api"

[[d1_databases]]
binding = "DB"
database_name = "kenresoft-cms-db"
database_id = "db-123"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "kenresoft-cms-media"

[vars]
CORS_ORIGINS = "http://localhost:5173"
BETTER_AUTH_URL = "${AUTH_URL_PLACEHOLDER}"
`;

test('parseLocalConfig reports the placeholder Better Auth URL as unconfigured', () => {
  const local = parseLocalConfig(BASE_TOML);
  assert.equal(local.betterAuthUrl.configured, false);
  assert.equal(local.betterAuthUrl.value, AUTH_URL_PLACEHOLDER);
});

test('parseLocalConfig reports a real, custom Better Auth URL as configured', () => {
  const toml = BASE_TOML.replace(AUTH_URL_PLACEHOLDER, 'https://cms.kenresoft.com');
  const local = parseLocalConfig(toml);
  assert.equal(local.betterAuthUrl.configured, true);
  assert.equal(local.betterAuthUrl.value, 'https://cms.kenresoft.com');
});

test('parseLocalConfig reports a previously-deployed *.workers.dev URL as configured too — not just a custom domain', () => {
  const toml = BASE_TOML.replace(AUTH_URL_PLACEHOLDER, 'https://kenresoft-cms-api.example.workers.dev');
  const local = parseLocalConfig(toml);
  assert.equal(local.betterAuthUrl.configured, true);
});

test('isRealAuthUrl rejects the placeholder and empty values, accepts anything else', () => {
  assert.equal(isRealAuthUrl(AUTH_URL_PLACEHOLDER), false);
  assert.equal(isRealAuthUrl(''), false);
  assert.equal(isRealAuthUrl(null), false);
  assert.equal(isRealAuthUrl('https://cms.example.com'), true);
});

test('parseLocalConfig with no EMAIL_PROVIDER line reports email as unconfigured', () => {
  const local = parseLocalConfig(BASE_TOML);
  assert.equal(local.email.provider, null);
});

test('classifyInstallStatus: resend is only "configured" once provider, from, and the secret all exist', () => {
  const local = parseLocalConfig(`${BASE_TOML}EMAIL_PROVIDER = "resend"\nEMAIL_FROM = "noreply@example.com"\n`);

  assert.equal(classifyInstallStatus(local, new Set()).email.configured, false, 'no RESEND_API_KEY secret yet');
  assert.equal(
    classifyInstallStatus(local, new Set(['RESEND_API_KEY'])).email.configured,
    true,
    'provider + from + secret all present',
  );
});

test('isFreshInstall is true only when neither the database nor the auth secret exist', () => {
  const local = parseLocalConfig(BASE_TOML);
  assert.equal(isFreshInstall(classifyInstallStatus(local, new Set())), false, 'database_id already present');

  const noDbToml = BASE_TOML.replace('database_id = "db-123"', '');
  const noDbLocal = parseLocalConfig(noDbToml);
  assert.equal(isFreshInstall(classifyInstallStatus(noDbLocal, new Set())), true);
  assert.equal(isFreshInstall(classifyInstallStatus(noDbLocal, new Set(['BETTER_AUTH_SECRET']))), false);
});

test('summarizeInstallStatus never includes a secret value, only configured/not', () => {
  const local = parseLocalConfig(`${BASE_TOML}EMAIL_PROVIDER = "resend"\nEMAIL_FROM = "noreply@example.com"\n`);
  const summary = summarizeInstallStatus(classifyInstallStatus(local, new Set(['RESEND_API_KEY', 'BETTER_AUTH_SECRET'])));
  assert.doesNotMatch(summary, /sk_|re_|[A-Za-z0-9]{32,}/, 'summary must never leak a secret-looking value');
  assert.match(summary, /Email \(resend\) configured/);
});

test('parseLocalConfig reports no custom domain and workers.dev enabled by default', () => {
  const local = parseLocalConfig(BASE_TOML);
  assert.deepEqual(local.domain.customDomains, []);
  assert.equal(local.domain.workersDevEnabled, true);
});

test('parseLocalConfig picks up a connected custom domain and a disabled workers.dev', () => {
  const toml = `workers_dev = false\n${BASE_TOML}\n[[routes]]\npattern = "api.example.com"\ncustom_domain = true\n`;
  const local = parseLocalConfig(toml);
  assert.deepEqual(local.domain.customDomains, ['api.example.com']);
  assert.equal(local.domain.workersDevEnabled, false);
});

test('summarizeInstallStatus flags the dangerous state: workers.dev disabled with no custom domain connected', () => {
  const toml = `workers_dev = false\n${BASE_TOML}`;
  const summary = summarizeInstallStatus(classifyInstallStatus(parseLocalConfig(toml), new Set()));
  assert.match(summary, /workers\.dev is disabled, so this Worker is unreachable/);
});

test('classifyInstallStatus: turnstile is configured only once the secret exists — not derivable from the toml at all', () => {
  const local = parseLocalConfig(BASE_TOML);
  assert.equal(classifyInstallStatus(local, new Set()).turnstile.configured, false);
  assert.equal(classifyInstallStatus(local, new Set(['TURNSTILE_SECRET_KEY'])).turnstile.configured, true);
});

test('summarizeInstallStatus reports Turnstile as optional, not required, and never leaks the secret', () => {
  const local = parseLocalConfig(BASE_TOML);
  const unconfigured = summarizeInstallStatus(classifyInstallStatus(local, new Set()));
  assert.match(unconfigured, /Turnstile not configured .*optional/);

  const configured = summarizeInstallStatus(classifyInstallStatus(local, new Set(['TURNSTILE_SECRET_KEY'])));
  assert.match(configured, /Turnstile bot check configured/);
  assert.doesNotMatch(configured, /sk_|re_|[A-Za-z0-9]{32,}/);
});

test('parseLocalConfig reads TURNSTILE_SITE_KEY as a plain, unmasked var — it is not a secret', () => {
  const toml = `${BASE_TOML}TURNSTILE_SITE_KEY = "0x4AAAAAAAtest"\n`;
  assert.equal(parseLocalConfig(toml).turnstile.siteKey, '0x4AAAAAAAtest');
  assert.equal(parseLocalConfig(BASE_TOML).turnstile.siteKey, null);
});

test('classifyInstallStatus: the site key and the secret are independent — either can be set without the other', () => {
  const toml = `${BASE_TOML}TURNSTILE_SITE_KEY = "0x4AAAAAAAtest"\n`;
  const local = parseLocalConfig(toml);

  // Site key present, secret absent: not "configured" (the secret is what actually gates
  // sign-up), but the site key still reads back correctly — a deployer may set it before the
  // secret, or a frontend developer setting up rendering before the operator finishes setup.
  const siteKeyOnly = classifyInstallStatus(local, new Set());
  assert.equal(siteKeyOnly.turnstile.configured, false);
  assert.equal(siteKeyOnly.turnstile.siteKey, '0x4AAAAAAAtest');

  // Secret present, site key absent: still fully "configured" — the bot check itself never
  // reads TURNSTILE_SITE_KEY.
  const secretOnly = classifyInstallStatus(parseLocalConfig(BASE_TOML), new Set(['TURNSTILE_SECRET_KEY']));
  assert.equal(secretOnly.turnstile.configured, true);
  assert.equal(secretOnly.turnstile.siteKey, null);
});

test('summarizeInstallStatus warns when a site key is set but the secret is not — the bot check is not actually enforced', () => {
  const toml = `${BASE_TOML}TURNSTILE_SITE_KEY = "0x4AAAAAAAtest"\n`;
  const summary = summarizeInstallStatus(classifyInstallStatus(parseLocalConfig(toml), new Set()));
  assert.match(summary, /site key set \(0x4AAAAAAAtest\) but no secret key/);
});
