// Single read-model for "what's already configured" on an install. setup.mjs/update.mjs used to
// each carry their own ad hoc per-field checks (ensureD1's own database_id test, ensureAuthSecret's
// own secret-list probe, ...) with no shared way to answer "is this a fresh install or a rerun" —
// which is exactly how BETTER_AUTH_URL and RESEND_API_KEY ended up being treated as
// always-safe-to-regenerate while every other field had its own bespoke preservation logic.
//
// Split into a local (file-only, no network, fully pure — unit-testable) layer and a remote
// (secret existence, requires `wrangler secret list`) layer, since only the local layer's
// classification logic needs to be exercised by tests without real Cloudflare access.
import { runWrangler } from './wrangler-cli.mjs';
import { extractTomlValue, findTopLevelBlock, readTomlFile } from './wrangler-toml.mjs';

// The literal placeholder wrangler.toml ships with before a first deploy exists — the one value
// BETTER_AUTH_URL is actually safe to overwrite automatically. Any other value, including a
// previous *.workers.dev URL that setup.mjs itself wrote in, is a real, load-bearing config value
// (sessions/CORS/OAuth callbacks already depend on it) and must never be silently replaced.
export const AUTH_URL_PLACEHOLDER = 'https://REPLACE_AFTER_FIRST_DEPLOY.workers.dev';

export function isRealAuthUrl(value) {
  return Boolean(value) && value !== AUTH_URL_PLACEHOLDER;
}

function readVar(toml, key) {
  return toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? null;
}

// Everything answerable from the file alone. Takes already-read toml text (not a path) so callers
// that already hold the text (e.g. mid-edit) don't force a redundant re-read, and so this stays
// trivially testable with an in-memory string.
export function parseLocalConfig(toml) {
  const d1Block = findTopLevelBlock(toml, '[[d1_databases]]');
  const r2Block = findTopLevelBlock(toml, '[[r2_buckets]]');
  const authUrl = readVar(toml, 'BETTER_AUTH_URL');
  const corsOrigins = (readVar(toml, 'CORS_ORIGINS') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    database: {
      configured: Boolean(d1Block && extractTomlValue(d1Block.text, 'database_id')),
      name: d1Block ? extractTomlValue(d1Block.text, 'database_name') : null,
      id: d1Block ? extractTomlValue(d1Block.text, 'database_id') : null,
    },
    storage: {
      configured: Boolean(r2Block && extractTomlValue(r2Block.text, 'bucket_name')),
      name: r2Block ? extractTomlValue(r2Block.text, 'bucket_name') : null,
    },
    betterAuthUrl: { value: authUrl, configured: isRealAuthUrl(authUrl) },
    email: { provider: readVar(toml, 'EMAIL_PROVIDER'), from: readVar(toml, 'EMAIL_FROM') },
    corsOrigins,
  };
}

export function readLocalConfig(tomlPath) {
  return parseLocalConfig(readTomlFile(tomlPath));
}

// Secrets are invisible to the file — this is the only layer that needs network access, and the
// only reason readInstallStatus() below can't be a pure function.
export function readSecretNames({ apiDir, wranglerTomlPath }) {
  try {
    const output = runWrangler(['secret', 'list', '--config', wranglerTomlPath, '--format', 'json'], {
      cwd: apiDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new Set(JSON.parse(output).map((secret) => secret.name));
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    // No Worker deployed yet (genuinely first-ever run) — confirmed distinct from an empty list.
    if (/not found/i.test(stderr)) return new Set();
    throw error;
  }
}

// Pure classification, split out from readInstallStatus() so it's testable with fabricated
// local-config + secret-set inputs instead of a real wrangler round trip.
export function classifyInstallStatus(local, secretNames) {
  const emailConfigured =
    local.email.provider === 'resend'
      ? Boolean(local.email.from) && secretNames.has('RESEND_API_KEY')
      : local.email.provider === 'cloudflare'
        ? Boolean(local.email.from)
        : false;

  return {
    ...local,
    authSecret: { configured: secretNames.has('BETTER_AUTH_SECRET') },
    email: { ...local.email, resendKeyConfigured: secretNames.has('RESEND_API_KEY'), configured: emailConfigured },
    adminUrl: { configured: secretNames.has('ADMIN_URL') },
  };
}

export function readInstallStatus({ apiDir, wranglerTomlPath }) {
  const local = readLocalConfig(wranglerTomlPath);
  const secretNames = readSecretNames({ apiDir, wranglerTomlPath });
  return classifyInstallStatus(local, secretNames);
}

// Only reports configured/not — never a secret's actual value, per the task's "mask secrets when
// displaying them" rule. Non-secret values (URLs, provider name) are shown, since they're not
// sensitive and seeing the real current value is the whole point of a rerun summary.
export function summarizeInstallStatus(status) {
  const lines = [
    `${status.database.configured ? '✓' : '✗'} Database ${status.database.configured ? 'configured' : 'not configured'}`,
    `${status.storage.configured ? '✓' : '✗'} Storage ${status.storage.configured ? 'configured' : 'not configured'}`,
    `${status.authSecret.configured ? '✓' : '✗'} Authentication ${status.authSecret.configured ? 'configured' : 'not configured'}`,
    status.betterAuthUrl.configured
      ? `✓ Better Auth URL configured (${status.betterAuthUrl.value})`
      : '✗ Better Auth URL not configured (still the pre-deploy placeholder)',
    status.email.provider
      ? `${status.email.configured ? '✓' : '⚠'} Email (${status.email.provider}) ${status.email.configured ? 'configured' : 'incomplete — check the missing piece below'}`
      : '✗ Email not configured (password-reset/verification mail will not be sent)',
  ];
  return lines.join('\n');
}

export function isFreshInstall(status) {
  return !status.database.configured && !status.authSecret.configured;
}
