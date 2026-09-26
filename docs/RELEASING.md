# Releasing Kenresoft CMS

Kenresoft CMS ships as numbered releases. Deployers move between them with `pnpm run update`
(see [`DEPLOYMENT.md`](DEPLOYMENT.md#updating-an-existing-install)); this page is how releases are
numbered and cut.

## What a release is

- **One version for the whole CMS**: the root `package.json`, `apps/api` and `apps/admin`. The API
  reads it from the root `package.json` at build time, and the admin shows it under
  **Settings → Updates**.
- **A git tag** `vX.Y.Z` on `develop`, **a GitHub release** with the same name, and **a section**
  `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`. The release notes are that section.
- **Not** the published npm packages (`@kenresoft-cms/contracts`, `@kenresoft-cms/astro`,
  `@kenresoft-cms/create`). They keep their own versions and are published separately.

`pnpm run update` moves an install to the newest release tag (or `--version X.Y.Z`). Unreleased
work on `develop` only reaches installs that opt in with `--branch develop`.

## Version numbers

[Semantic versioning](https://semver.org/). Before 1.0, the minor number plays the role of the
major one, as is usual for 0.x software:

| Change | While 0.x | From 1.0 |
|---|---|---|
| Breaking: anything that needs a deployer to act or breaks an integration — a removed or changed API field or route, a config/secret/binding that must be set, a data change that can't be undone, a behavior change listed under **Breaking** in the changelog | minor (0.9.x → 0.10.0) | major |
| New feature, new optional setting, or a database migration that needs no action | minor | minor |
| Bug fix, security fix, docs, or internal change with no visible effect on deployers | patch | patch |

When in doubt, bump the higher one. Anything that needs a deployer to act also goes under a
**Breaking** heading in the changelog, with the exact steps.

## Keeping the changelog

Every user-facing change adds a bullet under `## Unreleased` in `CHANGELOG.md` in the same pull
request, under **Added**, **Changed**, **Fixed**, **Security**, **Breaking** or **Migration**. Write
for someone deciding whether to update: what changed, what they need to do (if anything). The
release script refuses to cut a release with an empty `## Unreleased`.

## Cutting a release

From an up-to-date `develop` with a clean working tree and the GitHub CLI signed in:

```bash
pnpm run release -- minor --dry-run   # preview: version, notes, and what it will do
pnpm run release -- minor             # or patch / major / an explicit 0.9.0
```

It shows the new version and release notes, checks you're on a clean `develop` in sync with
`origin` and that the tag doesn't exist yet, and asks before pushing anything. Then it:

1. sets the version in the root, `apps/api` and `apps/admin` `package.json`,
2. moves `## Unreleased` into `## [X.Y.Z] - <today>` and starts a new, empty `## Unreleased`,
3. commits `release: vX.Y.Z` and creates the annotated tag `vX.Y.Z`,
4. pushes `develop` and the tag, and creates the GitHub release from that changelog section,
5. opens the `develop` → `main` pull request (or points at the open one).

Deployers get it with `pnpm run update` as soon as the tag is pushed. Merging the `main` pull
request keeps `main` pointing at the latest release; it doesn't affect deployers.

If any npm package changed in the release (for example the admin needs a newer
`@kenresoft-cms/contracts`), publish it before or right after cutting the release; the changelog
entry should say which.

### If something goes wrong

- **Before the push** (you answered no, or a check failed): nothing is changed, or only local
  files. `git reset --hard origin/develop` and `git tag -d vX.Y.Z` undo a local commit and tag.
- **After the push, before the GitHub release**: the tag is live and deployers can already update
  to it. Create the release by hand: `gh release create vX.Y.Z --title vX.Y.Z --notes-file notes.md
  --verify-tag`.
- **A broken release is out**: don't move or delete the tag, since installs may already be on it.
  Fix forward with a patch release.

## Rolling back an install

`pnpm run update` never downgrades. Moving an install back to an older release needs care, because
database migrations only run forwards: the older code may not understand columns or tables a newer
release added.

1. Prefer fixing forward: wait for, or ask for, a patch release.
2. If you must go back, restore the database to a point from before the update with D1 Time Travel
   (see "Backups and recovery" in `DEPLOYMENT.md`), check out the older tag (`git checkout
   vX.Y.Z`, then `pnpm install`), and deploy both Workers by hand as in sections 6 and 8 of
   `DEPLOYMENT.md`. Content saved after the restore point is lost, which is why fixing forward is
   preferred. Return to releases afterwards by checking out your branch again and running
   `pnpm run update`.

## Update check

**Settings → Updates** and the admin sidebar say when a newer release exists. The API Worker asks
GitHub for the latest release of `UPDATE_CHECK_REPO` (default `kenresoft-technologies/kenresoft-cms`)
and caches the answer for 6 hours (1 hour after a failure), so it stays within GitHub's limits. A
fork that publishes its own releases sets `UPDATE_CHECK_REPO = "your-org/your-fork"` under `[vars]`
in `wrangler.toml`; `"off"` turns the check off. The version is only shown to Admins and Owners and
is not on any public endpoint.
