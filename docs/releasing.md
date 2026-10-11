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

## Cut a release

1. Set the five packages to the new version and merge that in a pull request:

   ```sh
   node scripts/semver/bump.js 1.1.0
   ```

2. Tag the merge commit on `master` and push the tag:

   ```sh
   git tag v1.1.0 && git push origin v1.1.0
   ```

The tag runs `.github/workflows/release.yml`. It builds and packs the packages at the tag's version, refuses to continue if any package is at another version, checks each tarball's name, version, registry and sibling aliases, publishes the five packages to GitHub Packages, and creates a GitHub release with the five tarballs attached.

If a run fails, rerun it. It skips the packages that are already published.

GitHub creates each new package as private. After the first release, make the five packages public in each package's settings if consumers outside this account need them.

The release tarballs install from their URL with no token:

```json
"@excalidraw/excalidraw": "https://github.com/redaphid/excalidraw/releases/download/v1.0.0/excalidraw-excalidraw-1.0.0.tgz"
```
