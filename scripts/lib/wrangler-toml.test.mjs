import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addCustomDomainRoute,
  hasVarLine,
  readCustomDomainRoutes,
  readVarLine,
  readWorkersDevEnabled,
  removeVarLine,
  setVarLine,
  setWorkersDevEnabled,
} from './wrangler-toml.mjs';

const TOML = `name = "kenresoft-cms-api"

[vars]
CORS_ORIGINS = "http://localhost:5173"
BETTER_AUTH_URL = "https://REPLACE_AFTER_FIRST_DEPLOY.workers.dev"
`;

test('setVarLine only touches the requested key, never a neighboring one', () => {
  // This is a direct regression test for the actual reported bug: the old email-setup code
  // inserted EMAIL_PROVIDER/EMAIL_FROM by finding and rewriting the whole "BETTER_AUTH_URL ="
  // line, which reset a real custom Better Auth URL back to the pre-deploy placeholder as a side
  // effect of configuring email. setVarLine must never do that.
  const before = readVarLine(TOML, 'BETTER_AUTH_URL');
  const after = setVarLine(TOML, 'EMAIL_PROVIDER', 'resend');
  assert.equal(readVarLine(after, 'BETTER_AUTH_URL'), before);
  assert.equal(readVarLine(after, 'EMAIL_PROVIDER'), 'resend');
});

test('setVarLine inserts a new key into [vars] without one, and replaces it in place if it already exists', () => {
  assert.equal(hasVarLine(TOML, 'EMAIL_PROVIDER'), false);
  const withEmail = setVarLine(TOML, 'EMAIL_PROVIDER', 'cloudflare');
  assert.equal(readVarLine(withEmail, 'EMAIL_PROVIDER'), 'cloudflare');

  const changed = setVarLine(withEmail, 'EMAIL_PROVIDER', 'resend');
  assert.equal(readVarLine(changed, 'EMAIL_PROVIDER'), 'resend');
  // Exactly one line for the key, not two — replaced in place, not appended a second time.
  assert.equal((changed.match(/^EMAIL_PROVIDER\s*=/gm) ?? []).length, 1);
});

test('setVarLine on BETTER_AUTH_URL never regresses to appending a duplicate line', () => {
  const updated = setVarLine(TOML, 'BETTER_AUTH_URL', 'https://cms.example.com');
  assert.equal(readVarLine(updated, 'BETTER_AUTH_URL'), 'https://cms.example.com');
  assert.equal((updated.match(/^BETTER_AUTH_URL\s*=/gm) ?? []).length, 1);
});

test('removeVarLine drops the key entirely (used by "disable email")', () => {
  const withEmail = setVarLine(TOML, 'EMAIL_PROVIDER', 'resend');
  const removed = removeVarLine(withEmail, 'EMAIL_PROVIDER');
  assert.equal(hasVarLine(removed, 'EMAIL_PROVIDER'), false);
  // Unrelated vars survive.
  assert.equal(readVarLine(removed, 'BETTER_AUTH_URL'), readVarLine(TOML, 'BETTER_AUTH_URL'));
});

test('readWorkersDevEnabled defaults to true when absent, and reads an explicit value', () => {
  assert.equal(readWorkersDevEnabled(TOML), true);
  assert.equal(readWorkersDevEnabled(setWorkersDevEnabled(TOML, false)), false);
  assert.equal(readWorkersDevEnabled(setWorkersDevEnabled(TOML, true)), true);
});

test('setWorkersDevEnabled inserts once and replaces in place on a second call, never touching [vars]', () => {
  const disabled = setWorkersDevEnabled(TOML, false);
  assert.equal((disabled.match(/^workers_dev\s*=/gm) ?? []).length, 1);
  assert.equal(readVarLine(disabled, 'BETTER_AUTH_URL'), readVarLine(TOML, 'BETTER_AUTH_URL'));

  const reEnabled = setWorkersDevEnabled(disabled, true);
  assert.equal(readWorkersDevEnabled(reEnabled), true);
  assert.equal((reEnabled.match(/^workers_dev\s*=/gm) ?? []).length, 1);
});

test('addCustomDomainRoute appends a [[routes]] block, is idempotent, and supports more than one domain', () => {
  const once = addCustomDomainRoute(TOML, 'api.example.com');
  assert.deepEqual(readCustomDomainRoutes(once), ['api.example.com']);
  // Calling again with the same pattern must not duplicate the block.
  const twice = addCustomDomainRoute(once, 'api.example.com');
  assert.equal(twice, once);
  assert.equal((twice.match(/\[\[routes\]\]/g) ?? []).length, 1);

  const withSecond = addCustomDomainRoute(once, 'cms.example.com');
  assert.deepEqual(readCustomDomainRoutes(withSecond), ['api.example.com', 'cms.example.com']);
  // The rest of the file is untouched — this is always appended at the very end.
  assert.equal(readVarLine(withSecond, 'BETTER_AUTH_URL'), readVarLine(TOML, 'BETTER_AUTH_URL'));
});

test('readCustomDomainRoutes ignores a [[routes]] block that is not a custom_domain route', () => {
  const withPlainRoute = TOML + '\n[[routes]]\npattern = "example.com/*"\nzone_name = "example.com"\n';
  assert.deepEqual(readCustomDomainRoutes(withPlainRoute), []);
});
