# @kenresoft-cms/create

Scaffolds a new [Kenresoft CMS](https://github.com/kenresoft-technologies/kenresoft-cms) install by downloading the current `main` branch of the monorepo template — the same thing `git clone` gives you, minus needing to know the repo URL or have `.git` history dragged along.

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

This tool fetches the template fresh from GitHub on every run rather than bundling a copy of it, so it always scaffolds the current `main` branch — it does not need to be updated (or re-published) when the CMS itself changes, only if this download/extract script's own mechanics ever do.
