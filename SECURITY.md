# Security Policy

Kenresoft CMS is self-hosted: every deployment lives in the deployer's own Cloudflare account,
holds its own data, and is responsible for its own credentials and secrets (see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §11). Kenresoft itself holds no standing access
to any deployment — there is no shared infrastructure a single vulnerability here could expose
across multiple sites. That doesn't lower the bar on the codebase itself: a real bug still puts
every deployer running it at risk, and we treat reports accordingly.

## Supported versions

This project does not yet maintain parallel long-term-support branches. Security fixes are made
against, and only guaranteed for:

| Version                    | Supported |
| --------------------------- | --------- |
| `main` / latest release      | ✅        |
| Anything older                | ❌        |

Run `pnpm run update` (see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)) to stay current. Once this
project starts tagging releases, this table will be updated to reflect a real supported-versions
window.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.** A public issue
discloses the problem to potential attackers before a fix exists and before deployers have had a
chance to update.

Instead, use **[GitHub Private Vulnerability Reporting](../../security/advisories/new)** on this
repository (Security tab → "Report a vulnerability"). This opens a private draft security
advisory visible only to the maintainers and lets us collaborate on a fix with you directly,
including in a private fork if needed.

If private reporting isn't available to you for some reason, open a regular issue asking a
maintainer to contact you privately, without any vulnerability details in the issue itself.

Please include as much of the following as you can:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it (a minimal repro against a local `wrangler dev` instance is ideal — see
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for local setup).
- The affected version/commit.
- Any suggested fix or mitigation, if you have one.

## What to expect

- **Acknowledgement**: we aim to acknowledge a new report within 3 business days.
- **Triage**: we'll confirm whether it's a genuine vulnerability, assess its severity, and reply
  with our assessment and expected timeline.
- **Fix**: severity drives priority — a critical, remotely-exploitable issue (auth bypass,
  privilege escalation, data exposure across the trust boundaries described in
  `docs/ARCHITECTURE.md`) is treated as urgent; lower-severity issues are scheduled normally.
- **Disclosure**: once a fix is released, we'll publish a GitHub Security Advisory describing the
  issue and crediting the reporter (unless you'd prefer to stay anonymous). We ask that you hold
  off on public disclosure until a fix has shipped and deployers have had a reasonable window to
  update — coordinated disclosure, not silence indefinitely.

## Scope

In scope: `apps/api`, `apps/admin`, `packages/*`, `integrations/*`, and the deploy/setup scripts
under `scripts/` — anything that ships as part of a real deployment or the tooling that
provisions one.

Out of scope: `examples/astro-site` (a reference/demo site, not part of the CMS itself) and
findings that require an attacker to already have Owner/Admin-level access to a target
deployment (that's the trust boundary the architecture assumes — see `docs/ARCHITECTURE.md` §10).

## A note on this project's threat model

Several things that might look like gaps at first glance are deliberate, documented trade-offs
rather than oversights — for example, webhook destination URLs are intentionally unconstrained
(an admin-only capability; see the comment in `packages/contracts/schemas/webhooks.ts`), and the
break-glass `OWNER_RECOVERY_SECRET` route is off by default and 404s indistinguishably from a
route that doesn't exist until an operator deliberately sets it (`docs/ARCHITECTURE.md` §10.1).
If you're reporting something in this territory, it's still worth reporting — we'd rather
re-confirm a trade-off than miss a real issue — just know the report may come back as "working as
designed, here's why" rather than a fix.
