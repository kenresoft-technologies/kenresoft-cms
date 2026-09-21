# @kenresoft-cms/create

> **Official documentation:** guides, tutorials and troubleshooting live at https://docs.kenresoft.com/cms/. This README covers the CLI itself; see https://docs.kenresoft.com/cms/reference/cli/ and https://docs.kenresoft.com/cms/astro/existing-site/ for the full guides.

Scaffolds a new [Kenresoft CMS](https://github.com/kenresoft-technologies/kenresoft-cms) install with a real `git clone` of the monorepo template (its current default branch), named without having to remember the repo URL. Real git history is kept deliberately, not stripped — it's what lets `pnpm run update` later pull in new CMS code with a normal, low-conflict merge instead of every changed file coming back as a conflict.

```bash
npm create @kenresoft-cms@latest my-cms
cd my-cms
pnpm install
pnpm run setup
```

Omit the directory name to scaffold into the current directory (it must be empty):

```bash
npm create @kenresoft-cms@latest
```

`pnpm run setup` is the actual installer — it provisions Cloudflare D1/R2, deploys both Workers, and wires them together. This package only gets the files onto disk; see the [main repository](https://github.com/kenresoft-technologies/kenresoft-cms#readme) for what `pnpm run setup` does and every other install method.

This tool clones the template fresh from GitHub on every run rather than bundling a copy of it, so it always scaffolds the repo's current default branch — it does not need to be updated (or re-published) when the CMS itself changes, only if this script's own cloning mechanics ever do.

## Scaffolding just an Astro frontend (`--astro`)

If you already have a Kenresoft CMS deployment and only want a site that reads from it — not the
CMS itself — pass `--astro`:

```bash
npm create @kenresoft-cms@latest my-site -- --astro
cd my-site
cp .env.example .env   # set PUBLIC_KENRESOFT_CMS_URL to your deployed API Worker's URL
pnpm install
pnpm dev
```

Unlike the full CMS scaffold above, this copies a small template bundled with this package
(`templates/astro-starter`) rather than cloning the monorepo, and initializes a fresh,
standalone git repo with no shared history — there's no `pnpm run update`-style ongoing-merge
relationship for it, the same as any other one-time framework starter (`npm create astro@latest`
included). It depends on the published [`@kenresoft-cms/astro`](https://www.npmjs.com/package/@kenresoft-cms/astro)
package directly (pinned to whichever version is latest at scaffold time), not a workspace link.

See the scaffolded project's own README for what to customize first, or
[`docs/ASTRO.md`](https://github.com/kenresoft-technologies/kenresoft-cms/blob/main/docs/ASTRO.md)
in the main repo for everything the client supports beyond this starting point.

## Connecting an existing Astro project (`astro`)

Three separate things get updated, on three separate schedules. None of them touches another.

1. **The CMS** (API, admin, database migrations): `pnpm run update`, run inside your CMS
   repository. It never modifies any Astro website.
2. **The Kenresoft integration in your Astro site** (the few files Kenresoft generated for you):
   `npx @kenresoft-cms/create astro --update`, run inside your Astro project. It never modifies
   the CMS.
3. **The `@kenresoft-cms/astro` package** in your Astro site. The `--update` command above also
   moves this to the newest compatible version. It looks the version up on npm explicitly instead
   of relying on a caret range, because while packages are `0.x`, `^0.3.0` will not reach `0.4.0`.

**Connect an existing Astro project** (run from its root):

```bash
npx @kenresoft-cms/create astro --cms-url https://your-cms-api.example.com
```

1. It checks this is an Astro project (Astro 5 or newer) and reads your Astro version.
2. It installs `@kenresoft-cms/astro` if missing (or upgrades a version too old to work).
3. It adds the same-origin `/cms/*` proxy, so the session cookie stays first-party to your site.
4. It adds `PUBLIC_KENRESOFT_CMS_URL` to `.env` and `.env.example`, only if not already set.
5. It prints what it created, changed, skipped, and what you still need to do by hand.

Running it again is safe: it changes nothing that is already in place.

**Files Kenresoft owns** (marked `@kenresoft-managed`, tracked in `.kenresoft/integration.json`):

- `src/pages/cms/[...path].ts`, the proxy
- `src/lib/kenresoft.ts`, the client helpers (`cms`, `cmsForRequest`, `browserCms`)
- `.kenresoft/integration.json`, the record of what it wrote

Everything else (pages, layouts, components, styles, `astro.config`, wrangler config, your own
`.env` values) is yours and is never overwritten. If a file already sits at a managed path and
isn't byte-identical to what Kenresoft would write, it is reported as a **conflict** and left
alone (exit code 2). Re-run with `--force` to replace it deliberately. Things it can't safely edit
for you (an adapter, the `global_fetch_strictly_public` Workers flag, `TRUSTED_PROXY_SECRET`, your
CMS's `CORS_ORIGINS`) are listed under "Needs manual action".

**Update later:**

```bash
npx @kenresoft-cms/create astro --update
```

It refreshes the package and any managed file you haven't edited, and reports conflicts for the
ones you have. `--no-install` edits `package.json` only, if you want to run the install yourself.

The code lives in `lib/astro/`; this package only edits your project, while the runtime lives in `@kenresoft-cms/astro`.
