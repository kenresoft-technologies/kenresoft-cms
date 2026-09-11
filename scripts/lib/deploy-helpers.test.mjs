import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractDeployedUrl, resolvePublicAdminUrl } from './deploy-helpers.mjs';

function mkTempDirWithToml(content) {
  const dir = mkdtempSync(join(tmpdir(), 'kenresoft-deploy-helpers-'));
  const path = join(dir, 'wrangler.toml');
  writeFileSync(path, content);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Direct regression test: confirmed empirically against a real deploy that once a Worker's
// workers_dev route is disabled, `wrangler deploy`'s own stdout no longer prints a *.workers.dev
// line at all — only a "<domain> (custom domain)" line. The old workers.dev-only extraction threw
// "Could not find the deployed Worker URL" on every subsequent `pnpm run update`, even though the
// deploy itself succeeded — breaking updates outright for any install that disabled workers.dev.
test('extractDeployedUrl prefers workers.dev when present', () => {
  const output = [
    'Deployed kenresoft-website-api triggers (8.62 sec)',
    '  https://kenresoft-website-api.kenresoft.workers.dev',
    '  api.kenresoft.com (custom domain)',
    '  schedule: */5 * * * *',
  ].join('\n');
  assert.equal(extractDeployedUrl(output), 'https://kenresoft-website-api.kenresoft.workers.dev');
});

test('extractDeployedUrl falls back to a custom domain line when workers.dev is absent', () => {
  const output = [
    'Deployed kenresoft-website-api triggers (8.62 sec)',
    '  api.kenresoft.com (custom domain)',
    '  schedule: */5 * * * *',
  ].join('\n');
  assert.equal(extractDeployedUrl(output), 'https://api.kenresoft.com');
});

test('extractDeployedUrl returns null when neither line is present (a genuinely failed deploy)', () => {
  assert.equal(extractDeployedUrl('Something went wrong.\n'), null);
});

// Direct regression test: connecting a custom domain to the admin Worker never refreshed
// ADMIN_URL (the secret used to build password-reset/verification email links) — it stayed
// pinned to whatever workers.dev URL the very first `pnpm run setup` run happened to set it to,
// so every email link kept pointing at workers.dev regardless of any domain connected since.
test('resolvePublicAdminUrl prefers a connected custom domain over the deployed workers.dev URL', () => {
  const dir = mkTempDirWithToml(
    'name = "admin"\ncompatibility_date = "2026-01-01"\n\n[[routes]]\npattern = "cms.example.com"\ncustom_domain = true\n',
  );
  try {
    const url = resolvePublicAdminUrl({
      adminWranglerTomlPath: dir.path,
      deployedAdminUrl: 'https://admin-worker.example.workers.dev',
    });
    assert.equal(url, 'https://cms.example.com');
  } finally {
    dir.cleanup();
  }
});

test('resolvePublicAdminUrl falls back to the deployed URL when no custom domain is connected', () => {
  const dir = mkTempDirWithToml('name = "admin"\ncompatibility_date = "2026-01-01"\n');
  try {
    const url = resolvePublicAdminUrl({
      adminWranglerTomlPath: dir.path,
      deployedAdminUrl: 'https://admin-worker.example.workers.dev',
    });
    assert.equal(url, 'https://admin-worker.example.workers.dev');
  } finally {
    dir.cleanup();
  }
});
