# @kenresoft-cms/create

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
