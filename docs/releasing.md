# Releasing and installing the packages

The fork publishes five packages to GitHub Packages, the npm registry at `https://npm.pkg.github.com`. They share one semver version, starting at 1.0.0.

| Package on GitHub Packages | Source package |
| --- | --- |
| `@redaphid/excalidraw` | `packages/excalidraw` (`@excalidraw/excalidraw`) |
| `@redaphid/excalidraw-common` | `packages/common` |
| `@redaphid/excalidraw-element` | `packages/element` |
| `@redaphid/excalidraw-math` | `packages/math` |
| `@redaphid/excalidraw-fractional-indexing` | `packages/fractional-indexing` |

GitHub Packages accepts only the owner's scope, so the published names start with `@redaphid/`. The source keeps upstream's `@excalidraw/*` names, and each published package depends on its siblings through npm aliases, for example `"@excalidraw/common": "npm:@redaphid/excalidraw-common@1.0.0"`.

## Install the packages

GitHub Packages requires a token for every npm install, public packages included. Use a personal access token (classic) with the `read:packages` scope, or a workflow's `GITHUB_TOKEN` with `packages: read`.

1. Add an `.npmrc` next to your `package.json`:

   ```ini
   @redaphid:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

2. Depend on the package under upstream's name, so your imports stay the same:

   ```json
   {
     "dependencies": {
       "@excalidraw/excalidraw": "npm:@redaphid/excalidraw@^1.0.0"
     }
   }
   ```

   Alias `@excalidraw/common` or `@excalidraw/element` the same way, at the same version, if your code imports them.

3. Set `NODE_AUTH_TOKEN` and install.

Types resolve with npm and with pnpm's default layout. Under pnpm `hoist=false`, some declarations inside common and element reach types from packages they do not declare, such as `jotai`, and those turn into `any`.

## Releases happen on every merge

Each push to `master` runs `.github/workflows/auto-release.yml`. `scripts/semver/next.js` reads the conventional titles of the commits since the highest `vX.Y.Z` tag and picks the next version:

| Titles since the last tag | Release |
| --- | --- |
| any `!` after the type, or a `BREAKING CHANGE:` footer | major |
| any `feat` | minor |
| any `fix`, `perf` or `revert` | patch |
| only other types, such as `chore`, `docs`, `ci`, `refactor` or `test` | none |

It then calls `.github/workflows/release.yml`, which runs `bump.js` and commits the result as `github-actions[bot]` on top of the merge commit. Master's required checks refuse a direct push from a workflow, so that commit is reachable only from its tag, and the packages' version on `master` stays where the last hand bump left it. The next release counts from the tag's parent, which is on `master`. The commit has a fixed author and date, so a rerun builds the same commit and the same tag. The tag is pushed only after the tarballs pass every check below.

A merge that a tag already contains releases nothing, so a tag pushed by hand on a merge commit is never released twice. If the packages on `master` are at a version that no tag has released, from a bump PR merged by hand, the merge releases that version as is, without another bump. A pull request that changes the release workflows or `scripts/semver/` rehearses the release at the version `master` would get, through `publish.js --dry-run`.

## Cut a release by hand

To pick a version yourself:

1. Set the five packages to the new version and merge that in a pull request:

   ```sh
   node scripts/semver/bump.js 1.1.0
   ```

2. The merge releases that version. You may still tag the merge commit and push the tag yourself; whichever tag lands first releases it, and the other run finds the tag on the same commit:

   ```sh
   git tag v1.1.0 && git push origin v1.1.0
   ```

Either path runs `.github/workflows/release.yml`, one release at a time. It builds and packs the packages at the tag's version, refuses to continue if any package is at another version, and checks the tarballs the way a consumer uses them. `scripts/semver/typecheck-consumer.js` typechecks draw's calls against them. `scripts/semver/verify.js` installs the local tarballs into fresh projects, once from the release-asset tarballs and once from the GitHub Packages tarballs, with npm `overrides` pointing their sibling aliases at the local files instead of the registry. Nothing is fetched from GitHub Packages. There, `@excalidraw/excalidraw` has to install alone at the release version and bundle draw's calls and `index.css` with esbuild, under both the `development` and `production` conditions, every file in `themes/index.json` has to import through `./themes/*`, and common, fractional-indexing, math and element each have to load on their own in Node. It then checks each tarball's name, version, registry and sibling aliases, publishes the five packages to GitHub Packages, and creates a GitHub release with the five tarballs attached.

If a run fails, rerun it. It skips the packages that are already published.

To rehearse a release without publishing, run the same checks locally. CI's `pack` job runs them on every pull request.

```sh
node scripts/semver/pack.js --version=1.1.0
node scripts/semver/typecheck-consumer.js --version=1.1.0
node scripts/semver/verify.js --version=1.1.0
node scripts/semver/publish.js --version=1.1.0 --dry-run
```

The packages take the repository's public visibility. A tag that is not on `master` fails before anything is built, and a rerun replaces a draft release that a failed run left behind.

The release tarballs install from their URL with no token:

```json
"@excalidraw/excalidraw": "https://github.com/redaphid/excalidraw/releases/download/v1.0.0/excalidraw-excalidraw-1.0.0.tgz"
```
