import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasVarLine, readVarLine, removeVarLine, setVarLine } from './wrangler-toml.mjs';

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
