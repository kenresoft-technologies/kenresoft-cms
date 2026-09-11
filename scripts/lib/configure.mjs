// Targeted, single-category configuration changes — shared by `pnpm run setup`'s "Update
// configuration" path (a rerun against an existing install) and `pnpm run update -- --auth` /
// `--email` / `--storage` / `--database` (a standalone command, no other setup steps run).
//
// The rule every function here follows, per the non-negotiable project rule: a value changes only
// when the developer explicitly asks for that specific category *and* provides a new value.
// Blank/omitted input always means "leave unchanged" — never "clear" or "regenerate". This is
// centralized in resolveInput() below because bug history in this repo is exactly "an empty
// string was silently treated as a real value" (an empty RESEND_API_KEY secret) and "one field's
// insertion silently clobbered an unrelated field" (BETTER_AUTH_URL reset while wiring up email).
import { runWrangler } from './wrangler-cli.mjs';
import { ask, confirm, select } from './prompt.mjs';
import { readTomlFile, removeVarLine, setVarLine, writeTomlFile } from './wrangler-toml.mjs';
import { deployApi } from './deploy-helpers.mjs';

// ---- pure helpers (unit-tested without wrangler/network access) ----

export function resolveInput(rawInput) {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  return trimmed === '' ? { changed: false } : { changed: true, value: trimmed };
}

export function describeAuthUrl(status) {
  return status.betterAuthUrl.configured ? status.betterAuthUrl.value : '(not set — still the pre-deploy placeholder)';
}

export function describeEmail(status) {
  if (!status.email.provider) return 'not configured';
  const keyNote = status.email.provider === 'resend' ? `, key: ${status.email.resendKeyConfigured ? 'configured' : 'MISSING'}` : '';
  return `provider: ${status.email.provider}, from: ${status.email.from ?? '(not set)'}${keyNote}`;
}

// ---- Better Auth URL ----

export async function configureAuth({ wranglerTomlPath, apiDir, status, ci = false, env = process.env }) {
  console.log(`\nCurrent Better Auth URL: ${describeAuthUrl(status)}`);

  if (ci) {
    const { changed, value } = resolveInput(env.BETTER_AUTH_URL_NEW);
    if (!changed) {
      console.log('BETTER_AUTH_URL_NEW not set — leaving the existing Better Auth URL unchanged.');
      return { changed: false };
    }
    console.log(`Setting BETTER_AUTH_URL to "${value}" (non-interactive, explicitly requested).`);
    writeTomlFile(wranglerTomlPath, setVarLine(readTomlFile(wranglerTomlPath), 'BETTER_AUTH_URL', value));
    return { changed: true, redeployNeeded: true };
  }

  const choice = await select('What do you want to do?', [
    { value: 'keep', label: 'Keep existing value' },
    { value: 'change', label: 'Change value' },
    { value: 'reset', label: "Reset to the deployed Worker's own generated *.workers.dev URL" },
    { value: 'cancel', label: 'Cancel' },
  ]);
  if (choice === 'keep' || choice === 'cancel') {
    console.log('✓ Better Auth URL left unchanged.');
    return { changed: false };
  }

  console.log(
    '\n⚠ Changing the Better Auth URL affects existing sessions, trusted origins/CORS, OAuth ' +
      'callbacks, and any in-progress authentication flow. Anyone currently signed in may be ' +
      'signed out, and any callback registered with an external provider against the old value ' +
      'will break until updated there too.',
  );
  if (!(await confirm('Are you sure you want to proceed?', false))) {
    console.log('Cancelled — Better Auth URL left unchanged.');
    return { changed: false };
  }

  let value;
  if (choice === 'reset') {
    console.log("Deploying once to read the Worker's own real URL...");
    value = deployApi({ apiDir, wranglerTomlPath });
  } else {
    value = await ask('New Better Auth URL (e.g. https://cms.example.com)');
    if (!value) {
      console.log('No value entered — Better Auth URL left unchanged.');
      return { changed: false };
    }
  }

  writeTomlFile(wranglerTomlPath, setVarLine(readTomlFile(wranglerTomlPath), 'BETTER_AUTH_URL', value));
  console.log(`✓ Better Auth URL set to ${value}.`);
  return { changed: true, redeployNeeded: true };
}

// ---- Email (Resend / Cloudflare Email) ----

export async function configureEmail({ wranglerTomlPath, apiDir, status, ci = false, env = process.env }) {
  console.log(`\nCurrent email config: ${describeEmail(status)}`);

  if (ci) {
    const providerInput = resolveInput(env.EMAIL_PROVIDER_NEW);
    const fromInput = resolveInput(env.EMAIL_FROM_NEW);
    const keyInput = resolveInput(env.RESEND_API_KEY_NEW);
    if (!providerInput.changed && !fromInput.changed && !keyInput.changed) {
      console.log('No EMAIL_PROVIDER_NEW/EMAIL_FROM_NEW/RESEND_API_KEY_NEW set — leaving email configuration unchanged.');
      return { changed: false };
    }
    let toml = readTomlFile(wranglerTomlPath);
    if (providerInput.changed) toml = setVarLine(toml, 'EMAIL_PROVIDER', providerInput.value);
    if (fromInput.changed) toml = setVarLine(toml, 'EMAIL_FROM', fromInput.value);
    writeTomlFile(wranglerTomlPath, toml);
    if (keyInput.changed) {
      runWrangler(['secret', 'put', 'RESEND_API_KEY', '--config', wranglerTomlPath], { cwd: apiDir, input: keyInput.value });
    }
    console.log('✓ Email configuration updated (non-interactive) — only the fields explicitly set were touched.');
    return { changed: true, redeployNeeded: providerInput.changed || fromInput.changed };
  }

  const alreadyConfigured = Boolean(status.email.provider);
  const choice = alreadyConfigured
    ? await select('What do you want to do?', [
        { value: 'keep', label: 'Keep existing configuration' },
        { value: 'change', label: 'Change configuration' },
        { value: 'disable', label: 'Disable email sending (fall back to no-op)' },
        { value: 'cancel', label: 'Cancel' },
      ])
    : await select('Set up password-reset/verification email now?', [
        { value: 'change', label: 'Configure now (Cloudflare Email or Resend)' },
        { value: 'keep', label: "Skip — password reset will still work, it just won't send an email" },
        { value: 'cancel', label: 'Cancel' },
      ]);
  if (choice === 'keep' || choice === 'cancel') {
    console.log(alreadyConfigured ? '✓ Email configuration left unchanged.' : 'Skipping email setup (see docs/DEPLOYMENT.md to configure it later).');
    return { changed: false };
  }

  if (choice === 'disable') {
    if (!(await confirm('This stops password-reset/verification emails from sending. Continue?', false))) {
      return { changed: false };
    }
    let toml = removeVarLine(readTomlFile(wranglerTomlPath), 'EMAIL_PROVIDER');
    toml = removeVarLine(toml, 'EMAIL_FROM');
    writeTomlFile(wranglerTomlPath, toml);
    console.log(
      '✓ Email sending disabled. Any existing RESEND_API_KEY secret was left in place — remove it ' +
        'yourself with `wrangler secret delete RESEND_API_KEY` if you want it gone too.',
    );
    return { changed: true, redeployNeeded: true };
  }

  const provider = (await ask('Provider [cloudflare/resend]', status.email.provider ?? 'resend')).toLowerCase();
  if (provider !== 'cloudflare' && provider !== 'resend') {
    console.log(`Unrecognized provider "${provider}" — leaving email configuration unchanged.`);
    return { changed: false };
  }
  const from = await ask('Send from which address?', status.email.from ?? 'noreply@yourdomain.example');

  let toml = readTomlFile(wranglerTomlPath);
  toml = setVarLine(toml, 'EMAIL_PROVIDER', provider);
  toml = setVarLine(toml, 'EMAIL_FROM', from);
  writeTomlFile(wranglerTomlPath, toml);

  if (provider === 'resend') {
    const keyPrompt = status.email.resendKeyConfigured
      ? 'Paste a new Resend API key, or leave blank to keep the existing one'
      : 'Paste your Resend API key (leave blank to configure it later)';
    const { changed, value } = resolveInput(await ask(keyPrompt));
    if (changed) {
      runWrangler(['secret', 'put', 'RESEND_API_KEY', '--config', wranglerTomlPath], { cwd: apiDir, input: value });
      console.log('✓ Resend API key updated.');
    } else if (status.email.resendKeyConfigured) {
      console.log('✓ Existing Resend API key left unchanged.');
    } else {
      console.log(
        '⚠ No API key entered and none was already configured — Resend will report as not ' +
          'configured until you set one (`pnpm run update -- --email` again, or ' +
          '`wrangler secret put RESEND_API_KEY`).',
      );
    }
  } else {
    console.log(
      'Cloudflare Email selected — add a [[send_email]] binding to wrangler.toml and run ' +
        "`wrangler email sending enable` yourself (needs interactive domain verification this " +
        'script cannot automate). See docs/DEPLOYMENT.md.',
    );
  }

  console.log('✓ Email configuration updated.');
  return { changed: true, redeployNeeded: true };
}

// ---- Storage / Database ----
//
// Deliberately read-only beyond first provisioning (ensureD1()/ensureR2() in setup.mjs already
// own that). Repointing a live binding at a *different* database/bucket moves no data — there is
// no safe automatic action to offer, so these report status and explain the manual path rather
// than automating something a wrong answer could silently make destructive.

export async function configureDatabase({ status }) {
  console.log(
    `\nCurrent D1 database: ${status.database.configured ? `${status.database.name} (${status.database.id})` : 'not configured'}`,
  );
  if (!status.database.configured) {
    console.log('Not yet provisioned — run `pnpm run setup` to create it.');
    return { changed: false };
  }
  console.log(
    'Changing which database this deployment points at does not move any data — it only ' +
      'repoints the binding, and this script deliberately does not automate that. To point at a ' +
      "different, already-existing database, edit wrangler.toml's [[d1_databases]] database_id " +
      'by hand and redeploy.',
  );
  return { changed: false };
}

export async function configureStorage({ status }) {
  console.log(`\nCurrent R2 bucket: ${status.storage.configured ? status.storage.name : 'not configured'}`);
  if (!status.storage.configured) {
    console.log('Not yet provisioned — run `pnpm run setup` to create it.');
    return { changed: false };
  }
  console.log(
    'Changing which bucket this deployment points at does not move any uploaded media — it only ' +
      'repoints the binding, and this script deliberately does not automate that. To point at a ' +
      "different, already-existing bucket, edit wrangler.toml's [[r2_buckets]] bucket_name by " +
      'hand and redeploy.',
  );
  return { changed: false };
}
