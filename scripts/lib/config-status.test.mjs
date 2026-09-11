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
