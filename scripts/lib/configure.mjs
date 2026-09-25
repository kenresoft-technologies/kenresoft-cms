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
import {
  addCorsOrigin,
  addCustomDomainRoute,
  readTomlFile,
  removeCustomDomainRoute,
  removeVarLine,
  replaceCorsOrigin,
  setVarLine,
  setWorkersDevEnabled,
  writeTomlFile,
} from './wrangler-toml.mjs';
import { deployApi, deployAdminOnly } from './deploy-helpers.mjs';
import { parseLocalConfig } from './config-status.mjs';

// ---- pure helpers (unit-tested without wrangler/network access) ----

export function resolveInput(rawInput) {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  return trimmed === '' ? { changed: false } : { changed: true, value: trimmed };
}

export function describeAuthUrl(status) {
  return status.betterAuthUrl.configured ? status.betterAuthUrl.value : '(not set — still the pre-deploy placeholder)';
}

export function describeDomain(status) {
  const domains = status.domain.customDomains.length > 0 ? status.domain.customDomains.join(', ') : 'none';
  return `custom domain(s): ${domains}, workers.dev: ${status.domain.workersDevEnabled ? 'enabled' : 'disabled'}`;
}

export function describeEmail(status) {
  if (!status.email.provider) return 'not configured';
  const keyNote = status.email.provider === 'resend' ? `, key: ${status.email.resendKeyConfigured ? 'configured' : 'MISSING'}` : '';
  return `provider: ${status.email.provider}, from: ${status.email.from ?? '(not set)'}${keyNote}`;
}

export function describeTurnstile(status) {
  if (!status.turnstile.configured) return 'not configured';
  const siteKeyNote = status.turnstile.siteKey ? `, site key: ${status.turnstile.siteKey}` : ', site key: not set';
  return `configured (public sign-up requires a human check)${siteKeyNote}`;
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
    console.log(alreadyConfigured ? '✓ Email configuration left unchanged.' : 'Skipping email setup (to configure it later, see https://docs.kenresoft.com/cms/deployment/email/).');
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
        'script cannot automate). See https://docs.kenresoft.com/cms/deployment/email/',
    );
  }

  console.log('✓ Email configuration updated.');
  return { changed: true, redeployNeeded: true };
}

// ---- Turnstile (bot check on public sign-up) ----
//
// Manages both halves of one Cloudflare Turnstile widget in a single guided flow, which is the
// actual simplification over the original secret-only version: TURNSTILE_SECRET_KEY (server-side,
// verified against Cloudflare's siteverify endpoint by apps/api/src/middleware/turnstile.ts) is
// genuinely secret and lives only as a Worker secret, per this project's own "secrets never go in
// a database column or committed config" rule. TURNSTILE_SITE_KEY is the opposite — designed to
// be public, embedded directly in a frontend's own HTML/JS — so it's a plain wrangler.toml
// [vars] entry, not a secret. Storing it here too (rather than only in each frontend's own env)
// means GET /api/v1/system/status can hand it back to any frontend that asks
// (@kenresoft-cms/astro's system.status(), used by examples/astro-site's register page by
// default) — a deployer sets it in exactly one place instead of once per frontend. Setting only
// the secret key (skip the site key prompt) still works: the bot check itself never reads
// TURNSTILE_SITE_KEY, a frontend just has to supply its own site key some other way in that case.
// Every deployer creates and owns their own widget (dash.cloudflare.com → Turnstile) — nothing
// here is Kenresoft's own key, satisfying "the client deploying their own instance specifies
// their own site key and secret key."
export async function configureTurnstile({ wranglerTomlPath, apiDir, status, ci = false, env = process.env }) {
  console.log(`\nCurrent Turnstile config: ${describeTurnstile(status)}`);

  if (ci) {
    const secretInput = resolveInput(env.TURNSTILE_SECRET_KEY_NEW);
    const siteKeyInput = resolveInput(env.TURNSTILE_SITE_KEY_NEW);
    const disable = String(env.TURNSTILE_DISABLE ?? '').toLowerCase() === 'true';
    if (!secretInput.changed && !siteKeyInput.changed && !disable) {
      console.log('Neither TURNSTILE_SECRET_KEY_NEW nor TURNSTILE_SITE_KEY_NEW is set — leaving Turnstile configuration unchanged.');
      return { changed: false };
    }
    if (disable) {
      runWrangler(['secret', 'delete', 'TURNSTILE_SECRET_KEY', '--config', wranglerTomlPath], { cwd: apiDir, input: 'y\n' });
      writeTomlFile(wranglerTomlPath, removeVarLine(readTomlFile(wranglerTomlPath), 'TURNSTILE_SITE_KEY'));
      console.log('✓ Turnstile bot check disabled (non-interactive) — secret removed immediately; redeploying to also clear the site key var...');
      return { changed: true, redeployNeeded: true };
    }
    if (siteKeyInput.changed) {
      writeTomlFile(wranglerTomlPath, setVarLine(readTomlFile(wranglerTomlPath), 'TURNSTILE_SITE_KEY', siteKeyInput.value));
    }
    if (secretInput.changed) {
      runWrangler(['secret', 'put', 'TURNSTILE_SECRET_KEY', '--config', wranglerTomlPath], { cwd: apiDir, input: secretInput.value });
    }
    // Only the secret takes effect immediately (wrangler secret put applies to the live Worker
    // right away); the site key is a plain wrangler.toml var, which — unlike a secret — does
    // nothing to the already-deployed Worker until the next `wrangler deploy`. Claiming
    // redeployNeeded: false whenever the site key changed was a real, reported bug: the CLI said
    // "took effect immediately," but GET /api/v1/system/status kept returning the old (or no)
    // site key because the live Worker was never redeployed.
    console.log(
      siteKeyInput.changed
        ? '✓ Turnstile configuration updated (non-interactive) — redeploying so the new site key takes effect...'
        : '✓ Turnstile secret key updated (non-interactive) — takes effect immediately, no redeploy needed.',
    );
    return { changed: true, redeployNeeded: siteKeyInput.changed };
  }

  const alreadyConfigured = status.turnstile.configured;
  const choice = alreadyConfigured
    ? await select('What do you want to do?', [
        { value: 'keep', label: 'Keep existing configuration' },
        { value: 'change', label: 'Replace the secret key and/or site key' },
        { value: 'disable', label: 'Disable the bot check (remove both keys)' },
        { value: 'cancel', label: 'Cancel' },
      ])
    : await select('Require a human check (Cloudflare Turnstile) on public sign-up?', [
        { value: 'change', label: 'Configure now (paste a Turnstile widget secret key and site key)' },
        { value: 'keep', label: 'Skip — sign-up stays open, no bot check' },
        { value: 'cancel', label: 'Cancel' },
      ]);
  if (choice === 'keep' || choice === 'cancel') {
    console.log(alreadyConfigured ? '✓ Turnstile configuration left unchanged.' : 'Skipping Turnstile setup (create a widget any time at dash.cloudflare.com → Turnstile, then run this again).');
    return { changed: false };
  }

  if (choice === 'disable') {
    if (!(await confirm('This removes the bot check — public sign-up will accept requests with no human verification. Continue?', false))) {
      return { changed: false };
    }
    runWrangler(['secret', 'delete', 'TURNSTILE_SECRET_KEY', '--config', wranglerTomlPath], { cwd: apiDir, input: 'y\n' });
    writeTomlFile(wranglerTomlPath, removeVarLine(readTomlFile(wranglerTomlPath), 'TURNSTILE_SITE_KEY'));
    console.log('✓ Turnstile bot check disabled — the secret is gone immediately; redeploying to also clear the site key...');
    return { changed: true, redeployNeeded: true };
  }

  console.log(
    "\nCreate a Turnstile widget for your site's domain(s) at dash.cloudflare.com → Turnstile if " +
      "you haven't already — it gives you a secret key (below) and a site key. Setting the site " +
      'key here too (it is public, safe to store as a plain var) lets any frontend built with ' +
      '@kenresoft-cms/astro fetch it automatically instead of needing its own copy.',
  );
  const secretResult = resolveInput(await ask('Turnstile secret key (leave blank to keep the existing one / skip)'));
  if (secretResult.changed) {
    runWrangler(['secret', 'put', 'TURNSTILE_SECRET_KEY', '--config', wranglerTomlPath], { cwd: apiDir, input: secretResult.value });
    console.log('✓ Turnstile secret key set.');
  } else if (alreadyConfigured) {
    console.log('✓ Existing Turnstile secret key left unchanged.');
  } else {
    console.log('⚠ No secret key entered — the bot check stays off regardless of any site key set below.');
  }

  const siteKeyPrompt = status.turnstile.siteKey
    ? `Turnstile site key (public, currently ${status.turnstile.siteKey} — leave blank to keep it)`
    : 'Turnstile site key (public, leave blank to skip)';
  const siteKeyResult = resolveInput(await ask(siteKeyPrompt));
  if (siteKeyResult.changed) {
    writeTomlFile(wranglerTomlPath, setVarLine(readTomlFile(wranglerTomlPath), 'TURNSTILE_SITE_KEY', siteKeyResult.value));
    console.log('✓ Turnstile site key set — will be readable from GET /api/v1/system/status once redeployed (below).');
  } else if (status.turnstile.siteKey) {
    console.log('✓ Existing Turnstile site key left unchanged.');
  } else {
    console.log('Skipping the site key — set PUBLIC_TURNSTILE_SITE_KEY (or your frontend\'s equivalent) yourself instead.');
  }

  if (!secretResult.changed && !siteKeyResult.changed) {
    console.log('No values entered — Turnstile configuration left unchanged.');
    return { changed: false };
  }
  // See the CI branch's comment above: only a secret change is live immediately; a site-key
  // (var) change needs an actual redeploy to reach the running Worker.
  console.log(
    siteKeyResult.changed
      ? '✓ Turnstile configuration updated — redeploying so the new site key takes effect...'
      : '✓ Turnstile secret key updated — takes effect immediately, no redeploy needed.',
  );
  return { changed: true, redeployNeeded: siteKeyResult.changed };
}

// ---- Custom domain / workers.dev ----
//
// Connects a custom domain the way `wrangler deploy` already can automate: a `[[routes]]` entry
// with `custom_domain = true` makes Cloudflare create the DNS record and route on the next deploy
// (confirmed against Cloudflare's own current docs) — no dashboard click-through needed, as long
// as the domain's zone is already on this Cloudflare account. Disabling workers.dev is a
// deliberately separate, opt-in second step (default: leave it enabled) — connect and verify the
// custom domain actually works first, then come back and turn off the fallback, rather than
// cutting off the only working URL before confirming the replacement serves traffic. This exists
// specifically because a manual dashboard toggle of workers_dev, done before the admin app had
// ever been rebuilt against the custom domain, broke the live admin app once — see
// resolveAdminApiUrl's own comment in deploy-helpers.mjs for the incident this closes.
export async function configureDomain({ wranglerTomlPath, apiDir, status, ci = false, env = process.env }) {
  console.log(`\nCurrent domain config: ${describeDomain(status)}`);

  if (ci) {
    const domainInput = resolveInput(env.CUSTOM_DOMAIN_NEW);
    if (!domainInput.changed) {
      console.log('CUSTOM_DOMAIN_NEW not set — leaving domain configuration unchanged.');
      return { changed: false };
    }
    let toml = addCustomDomainRoute(readTomlFile(wranglerTomlPath), domainInput.value);
    const disableWorkersDev = String(env.DISABLE_WORKERS_DEV ?? '').toLowerCase() === 'true';
    // Wrangler's own default for an absent `workers_dev` flips to disabled the moment any
    // `[[routes]]` entry exists — write it explicitly either way, or "leave it enabled" (the
    // absence of DISABLE_WORKERS_DEV=true) would silently disable it instead.
    toml = setWorkersDevEnabled(toml, !disableWorkersDev);
    writeTomlFile(wranglerTomlPath, toml);
    console.log(
      `✓ Added custom domain "${domainInput.value}" (non-interactive)` + (disableWorkersDev ? ', and disabled workers.dev.' : ', workers.dev left enabled.'),
    );
    return { changed: true, redeployNeeded: true };
  }

  const domain = await ask(
    'Custom domain to connect (e.g. api.example.com) — its zone must already be on this ' +
      'Cloudflare account, leave blank to skip',
  );
  if (!domain) {
    console.log('No domain entered — domain configuration left unchanged.');
    return { changed: false };
  }
  console.log(
    '\nThis writes a [[routes]] entry (custom_domain = true) and redeploys — Cloudflare creates ' +
      "the DNS record and route for you on that deploy, nothing to do in the dashboard first, as " +
      "long as the domain's zone is already on this Cloudflare account.",
  );
  if (!(await confirm(`Connect "${domain}" now?`, true))) {
    console.log('Cancelled — domain configuration left unchanged.');
    return { changed: false };
  }

  // Wrangler's own default for an absent `workers_dev` flips to disabled the moment any
  // `[[routes]]` entry exists (confirmed empirically — the docs claim it defaults to enabled
  // unconditionally, which is only true before any route exists) — write it explicitly true here
  // so "leave it enabled for now" is real, not silently undone by adding the route.
  let toml = addCustomDomainRoute(readTomlFile(wranglerTomlPath), domain);
  toml = setWorkersDevEnabled(toml, true);
  writeTomlFile(wranglerTomlPath, toml);
  console.log(`✓ Added "${domain}" — redeploying so Cloudflare provisions the DNS record and route...`);
  deployApi({ apiDir, wranglerTomlPath });
  console.log(`✓ "${domain}" connected — verify it actually serves the API before disabling workers.dev.`);

  let workersDevDisabled = false;
  if (
    await confirm(
      "\nDisable the *.workers.dev fallback URL now? (Only do this once you've confirmed the " +
        'custom domain actually works — reversing it needs another `pnpm run update -- --domain` ' +
        'run, or the dashboard.)',
      false,
    )
  ) {
    writeTomlFile(wranglerTomlPath, setWorkersDevEnabled(readTomlFile(wranglerTomlPath), false));
    workersDevDisabled = true;
    console.log('✓ workers.dev will be disabled on the next redeploy.');
  } else {
    console.log('✓ workers.dev left enabled — reachable at both URLs for now.');
  }

  console.log(
    '\nNext step: run `pnpm run update -- --auth` to point BETTER_AUTH_URL at the new domain and ' +
      'rebuild the admin app against it — the admin app is still built against whatever ' +
      'BETTER_AUTH_URL currently says until you do that.',
  );

  return { changed: true, redeployNeeded: workersDevDisabled };
}

// ---- Admin custom domain / workers.dev ----
//
// Same idea as configureDomain above, but targeting the Admin Worker's own, completely separate
// wrangler.toml (apps/admin/wrangler.toml) — plus two things the API-domain flow doesn't need:
// refreshing the ADMIN_URL secret (used to build every password-reset/verification email link)
// and migrating the API's own CORS_ORIGINS allow-list, since both depend on the Admin app's public
// origin specifically, not the API's. Confirmed as a real, live gap before this: connecting a
// custom domain to the admin Worker never touched either — email links and CORS both kept
// pointing at whatever *.workers.dev URL the very first `pnpm run setup` run happened to set,
// regardless of any domain connected since.
//
// Deliberately never touches BETTER_AUTH_URL — that belongs to the API/Auth Worker and is a
// separate concept from the Admin app's own public URL (sessions/trusted-origins/OAuth callbacks
// all key off it); changing it is `pnpm run update -- --auth`'s job alone, never a side effect of
// this one.
//
// Sequenced so a failure never leaves a half-migrated, broken install: the Admin Worker's own
// wrangler.toml edit + deploy happens first, and CORS_ORIGINS/ADMIN_URL are only ever touched once
// that deploy has actually succeeded — a failed Admin deploy throws before any of that runs, and a
// failed API-side step (ADMIN_URL secret, CORS write, or the API redeploy) is caught and reported
// as "Admin deployed, API configuration still pending" rather than silently swallowed or
// misreported as a complete success. Re-running the command after either failure is always safe:
// every write here (the route, ADMIN_URL, CORS_ORIGINS) is itself idempotent, so a second run
// converges to the same correct end state without duplicating anything.
//
// `deployAdmin`/`putSecret` are injectable (default to the real wrangler-shelling
// implementations) purely so this can be unit-tested against a fake Cloudflare without a real
// account — every other exported function in this file that shells out to wrangler is either pure
// or, like configureDomain's interactive branch, untested for the same reason; this one has a
// CI path that *always* shells out, unlike configureDomain's CI path, which doesn't, so it needs
// the seam configureDomain never did.
export function normalizeAdminDomain(input) {
  return String(input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// Pure: given the admin Worker's *current* known public origin (before any change), the requested
// new domain, and the API's current CORS_ORIGINS toml text, computes the exact resulting
// CORS_ORIGINS value and whether it actually changed — split out from the impure orchestration
// below so the CORS-migration rules themselves (replace old admin origin, preserve every unrelated
// origin, dedupe, handle "no existing config") are directly unit-testable.
//
// `oldAdminOrigin` is `null` when the caller could not confidently identify a single old origin to
// retire (see configureAdminDomain's own ambiguity handling below) — in that case the only safe
// action is to *add* the new origin and touch nothing else, never guess at what to replace/remove.
export function planAdminDomainCorsUpdate(apiToml, oldAdminOrigin, newAdminOrigin) {
  return oldAdminOrigin ? replaceCorsOrigin(apiToml, oldAdminOrigin, newAdminOrigin) : addCorsOrigin(apiToml, newAdminOrigin);
}

export async function configureAdminDomain({
  adminWranglerTomlPath,
  adminDir,
  apiWranglerTomlPath,
  apiDir,
  ci = false,
  env = process.env,
  deployAdmin = deployAdminOnly,
  deployApiFn = deployApi,
  putSecret = (name, value, { config, cwd }) => runWrangler(['secret', 'put', name, '--config', config], { cwd, input: value }),
}) {
  const readAdminToml = () => readTomlFile(adminWranglerTomlPath);
  const currentStatus = { domain: parseLocalConfig(readAdminToml()).domain };
  console.log(`\nCurrent admin domain config: ${describeDomain(currentStatus)}`);

  // Step 2 of the documented sequence: determine the admin app's current real public origin
  // *before* touching anything, so it can be removed from CORS_ORIGINS once the new one is live.
  // A connected custom domain is authoritative on its own; otherwise the only way to learn the
  // real *.workers.dev URL without guessing at the account's subdomain is a no-config-change
  // deploy (harmless and idempotent — the same "deploy once just to read the real URL" pattern
  // configureAuth's own 'reset' choice already uses for the API Worker).
  //
  // Real, reported incident this guards against: an earlier version of this function always
  // picked `existingDomains[0]` as "the" old origin. With more than one custom-domain route
  // already on the Admin Worker (a prior manual wrangler.toml edit, an earlier partial migration
  // attempt, ...), that guess can silently be wrong — and handing a wrong `oldAdminOrigin` to the
  // CORS-migration step then replaces/removes a completely unrelated, still-in-use origin from a
  // live deployment's CORS_ORIGINS with no warning. Never guess when there's more than one
  // candidate: resolve it explicitly (an env var in CI, a prompt interactively), or fall back to
  // add-only — touching no existing CORS entry at all — if it's left unresolved.
  const existingDomains = currentStatus.domain.customDomains;
  let oldAdminOrigin;
  let oldDomain = null; // bare hostname; only set once there's a real `[[routes]]` entry to retire
  let ambiguousOldDomain = false;
  if (existingDomains.length === 0) {
    oldAdminOrigin = deployAdmin({ adminDir });
  } else if (existingDomains.length === 1) {
    oldDomain = existingDomains[0];
    oldAdminOrigin = `https://${oldDomain}`;
  } else {
    ambiguousOldDomain = true;
    oldAdminOrigin = null;
  }

  const applyNewDomain = (domainInput, disableWorkersDev) => {
    let toml = addCustomDomainRoute(readAdminToml(), domainInput);
    // See configureDomain's own comment for why workers_dev must be written explicitly once any
    // route exists — its implicit default flips from enabled to disabled the moment one does.
    toml = setWorkersDevEnabled(toml, !disableWorkersDev);
    writeTomlFile(adminWranglerTomlPath, toml);
  };

  // Everything from here on is the API-side half of the migration (ADMIN_URL + CORS_ORIGINS +
  // API redeploy) — wrapped so a failure here is reported distinctly from an Admin-deploy
  // failure (which throws before this point is ever reached at all) per the task's own required
  // failure-reporting distinction.
  const migrateApiConfig = (newAdminOrigin) => {
    try {
      putSecret('ADMIN_URL', newAdminOrigin, { config: apiWranglerTomlPath, cwd: apiDir });
      console.log(`✓ ADMIN_URL updated to ${newAdminOrigin} — new password-reset/verification emails will link there.`);

      const { toml: newApiToml, changed: corsChanged } = planAdminDomainCorsUpdate(readTomlFile(apiWranglerTomlPath), oldAdminOrigin, newAdminOrigin);
      if (!corsChanged) {
        console.log('✓ CORS_ORIGINS already correct — nothing to change.');
        return { apiConfigComplete: true, apiRedeployed: false };
      }
      writeTomlFile(apiWranglerTomlPath, newApiToml);
      console.log(`✓ CORS_ORIGINS updated (added ${newAdminOrigin}${oldAdminOrigin !== newAdminOrigin ? `, removed ${oldAdminOrigin}` : ''}) — redeploying the API Worker...`);
      const apiUrl = deployApiFn({ apiDir, wranglerTomlPath: apiWranglerTomlPath });
      console.log(`✓ API redeployed: ${apiUrl}`);
      return { apiConfigComplete: true, apiRedeployed: true };
    } catch (error) {
      console.error(
        `\n⚠ The Admin Worker deployed successfully with its new domain, but updating the API's ` +
          `ADMIN_URL/CORS_ORIGINS (or redeploying the API) failed: ${error instanceof Error ? error.message : error}\n` +
          'The migration is NOT complete — the admin app is live at its new domain, but ' +
          'password-reset/verification email links and CORS may still reference the old one. ' +
          'Re-run `pnpm run update -- --admin-domain` (interactive) or with --ci once the ' +
          'underlying issue is fixed; it will safely pick up from here.',
      );
      return { apiConfigComplete: false, apiRedeployed: false, error };
    }
  };

  if (ci) {
    const domainInput = resolveInput(env.ADMIN_CUSTOM_DOMAIN_NEW);
    if (!domainInput.changed) {
      console.log('ADMIN_CUSTOM_DOMAIN_NEW not set — leaving admin domain configuration unchanged.');
      return { changed: false };
    }
    const newDomain = normalizeAdminDomain(domainInput.value);
    const newAdminOrigin = `https://${newDomain}`;
    const disableWorkersDev = String(env.DISABLE_WORKERS_DEV ?? '').toLowerCase() === 'true';

    if (ambiguousOldDomain) {
      const oldDomainInput = resolveInput(env.ADMIN_OLD_DOMAIN_NEW);
      if (oldDomainInput.changed) {
        const candidate = normalizeAdminDomain(oldDomainInput.value);
        if (!existingDomains.includes(candidate)) {
          throw new Error(
            `ADMIN_OLD_DOMAIN_NEW="${oldDomainInput.value}" does not match any of this Admin ` +
              `Worker's existing custom domains (${existingDomains.join(', ')}) — refusing to guess.`,
          );
        }
        oldDomain = candidate;
        oldAdminOrigin = `https://${candidate}`;
      } else {
        console.log(
          `⚠ The Admin Worker already has more than one custom domain connected (${existingDomains.join(', ')}) ` +
            '— which one is being retired cannot be determined automatically. CORS_ORIGINS will ' +
            'only get the new origin ADDED; no existing entry will be replaced or removed. Set ' +
            'ADMIN_OLD_DOMAIN_NEW to be explicit, or clean up CORS_ORIGINS by hand afterward.',
        );
      }
    }

    applyNewDomain(newDomain, disableWorkersDev);
    // Deliberately not caught: an Admin-deploy failure must throw and leave CORS_ORIGINS/ADMIN_URL
    // completely untouched, per the task's own failure-handling requirement — nothing below this
    // line has run yet, so there is nothing to roll back.
    deployAdmin({ adminDir });
    console.log(
      `✓ Added admin custom domain "${newDomain}" (non-interactive)` +
        (disableWorkersDev ? ', and disabled workers.dev.' : ', workers.dev left enabled.'),
    );

    const { apiConfigComplete, apiRedeployed } = migrateApiConfig(newAdminOrigin);
    if (!apiConfigComplete) {
      throw new Error('Admin domain migration incomplete — see the error above.');
    }

    // Only ever retires a route this run could confidently identify — never the ambiguous case
    // left unresolved above, and never the auto-detected workers.dev origin (there's no
    // `[[routes]]` entry for that to remove in the first place).
    let oldRouteRemoved = false;
    if (oldDomain && oldDomain !== newDomain && String(env.REMOVE_OLD_ADMIN_DOMAIN ?? '').toLowerCase() === 'true') {
      writeTomlFile(adminWranglerTomlPath, removeCustomDomainRoute(readAdminToml(), oldDomain));
      deployAdmin({ adminDir });
      oldRouteRemoved = true;
      console.log(`✓ Removed the old "${oldDomain}" route from the Admin Worker — it's free for another use now.`);
    }

    return { changed: true, redeployNeeded: false, apiRedeployed, oldRouteRemoved };
  }

  const domain = await ask(
    'Custom domain to connect to the Admin app (e.g. cms.example.com) — its zone must already be ' +
      'on this Cloudflare account, leave blank to skip',
  );
  if (!domain) {
    console.log('No domain entered — admin domain configuration left unchanged.');
    return { changed: false };
  }
  const newDomain = normalizeAdminDomain(domain);
  const newAdminOrigin = `https://${newDomain}`;

  if (ambiguousOldDomain) {
    console.log(
      `\n⚠ The Admin Worker already has more than one custom domain connected: ${existingDomains.join(', ')}.\n` +
        'To correctly migrate ADMIN_URL/CORS_ORIGINS, which one is the current one being retired?',
    );
    const choice = await select('Old admin domain being retired', [
      ...existingDomains.map((d) => ({ value: d, label: d })),
      { value: '__none__', label: "None of these — just add the new origin, don't touch CORS_ORIGINS" },
    ]);
    if (choice !== '__none__') {
      oldDomain = choice;
      oldAdminOrigin = `https://${choice}`;
    } else {
      console.log('Proceeding without an old origin to retire — CORS_ORIGINS will only get the new origin added.');
    }
  }

  console.log(
    '\nThis writes a [[routes]] entry (custom_domain = true) to the Admin Worker, deploys it, then ' +
      "updates the API's ADMIN_URL and CORS_ORIGINS to match (and redeploys the API if CORS " +
      'actually changed) — never BETTER_AUTH_URL, which is a separate, API-side concept ' +
      "(`pnpm run update -- --auth` changes that one). Cloudflare creates the DNS record and " +
      "route for you on the Admin deploy, nothing to do in the dashboard first, as long as the " +
      "domain's zone is already on this Cloudflare account.",
  );
  if (!(await confirm(`Connect "${newDomain}" to the admin app now?`, true))) {
    console.log('Cancelled — admin domain configuration left unchanged.');
    return { changed: false };
  }

  applyNewDomain(newDomain, false);
  console.log(`✓ Added "${newDomain}" — redeploying so Cloudflare provisions the DNS record and route...`);
  // Deliberately not caught — see the CI branch's own comment above.
  deployAdmin({ adminDir });
  console.log(`✓ "${newDomain}" connected — verify it actually serves the admin app before disabling workers.dev.`);

  const { apiConfigComplete, apiRedeployed } = migrateApiConfig(newAdminOrigin);
  if (!apiConfigComplete) {
    throw new Error('Admin domain migration incomplete — see the error above.');
  }

  let oldRouteRemoved = false;
  if (oldDomain && oldDomain !== newDomain) {
    if (
      await confirm(
        `\nRemove the old "${oldDomain}" route from the Admin Worker now, freeing it up for ` +
          `another use? (Only do this once you've confirmed "${newDomain}" actually works.)`,
        false,
      )
    ) {
      writeTomlFile(adminWranglerTomlPath, removeCustomDomainRoute(readAdminToml(), oldDomain));
      deployAdmin({ adminDir });
      oldRouteRemoved = true;
      console.log(`✓ Removed the old "${oldDomain}" route.`);
    } else {
      console.log(`✓ Left the old "${oldDomain}" route in place — run this command again later to remove it.`);
    }
  }

  if (
    await confirm(
      "\nDisable the *.workers.dev fallback URL now? (Only do this once you've confirmed the " +
        'custom domain actually works.)',
      false,
    )
  ) {
    writeTomlFile(adminWranglerTomlPath, setWorkersDevEnabled(readAdminToml(), false));
    deployAdmin({ adminDir });
    console.log('✓ workers.dev disabled.');
  } else {
    console.log('✓ workers.dev left enabled — reachable at both URLs for now.');
  }

  return { changed: true, redeployNeeded: false, apiRedeployed, oldRouteRemoved };
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
