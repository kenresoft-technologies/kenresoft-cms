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
