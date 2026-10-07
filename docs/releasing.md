# Releasing and installing the packages

The fork publishes five packages to GitHub Packages, the npm registry at `https://npm.pkg.github.com`. They release together at one version, starting at 1.0.0, and the version follows semver.

| Package on GitHub Packages | Source package |
| --- | --- |
| `@redaphid/excalidraw` | `packages/excalidraw` (`@excalidraw/excalidraw`) |
| `@redaphid/excalidraw-common` | `packages/common` |
| `@redaphid/excalidraw-element` | `packages/element` |
| `@redaphid/excalidraw-math` | `packages/math` |
| `@redaphid/excalidraw-fractional-indexing` | `packages/fractional-indexing` |

GitHub Packages accepts only the owner's scope, so the published names start with `@redaphid/`. The source keeps upstream's `@excalidraw/*` names. The built code still imports `@excalidraw/common` and its siblings, so each published package declares its siblings as npm aliases, for example `"@excalidraw/common": "npm:@redaphid/excalidraw-common@1.0.0"`.

Nothing is published to registry.npmjs.org. `scripts/check-no-npm-publish.sh` fails CI if a workflow or script could publish there, and `scripts/semver/publish.js` refuses any package that does not target GitHub Packages.

## Install the packages

The five packages are public. GitHub Packages still requires a token for every npm install, public packages included, so every consumer needs a token with the `read:packages` scope. Only the container registry allows anonymous pulls.

1. Add an `.npmrc` next to your `package.json`:

   ```ini
   @redaphid:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

   The first line sends only `@redaphid/*` to GitHub. Upstream packages the editor depends on, such as `@excalidraw/laser-pointer`, still come from npmjs.

2. Depend on the package under upstream's name, so your imports stay the same:

   ```json
   {
     "dependencies": {
       "@excalidraw/excalidraw": "npm:@redaphid/excalidraw@^1.0.0"
     }
   }
   ```

   ```ts
   import { Excalidraw } from "@excalidraw/excalidraw";
   import "@excalidraw/excalidraw/index.css";
   ```

   If your code also imports `@excalidraw/common` or `@excalidraw/element`, alias them the same way, at the same version. The five packages are released in lockstep, so mixed versions are never tested together.

   You can also depend on `"@redaphid/excalidraw": "^1.0.0"` and import from `@redaphid/excalidraw`.

3. Set `NODE_AUTH_TOKEN` and install. npm, pnpm and yarn 1 all read the `.npmrc`.

### Get a token on your machine

Use a personal access token (classic) with the `read:packages` scope. GitHub Packages does not accept fine-grained tokens. Create one under **Settings**, **Developer settings**, **Personal access tokens**, **Tokens (classic)**, then export it:

```sh
export NODE_AUTH_TOKEN=ghp_...
```

Keep the token out of the committed `.npmrc`. The `${NODE_AUTH_TOKEN}` reference makes npm read it from the environment.

### Install in GitHub Actions

In a workflow, the job's `GITHUB_TOKEN` can install the packages:

```yaml
permissions:
  contents: read
  packages: read
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
  - run: npm ci
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This works from any repository because the packages are public. A private package is readable only by workflows in repositories that its settings list under **Manage Actions access**.

## Cut a release

Run the **Semver release** workflow on `master`:

```sh
gh workflow run semver-release.yml -R redaphid/excalidraw
```

The workflow computes the version, builds and verifies the packages, then publishes. Its jobs run in this order:

1. `plan` picks the version and writes the release notes (see [How the version is chosen](#how-the-version-is-chosen)).
2. `build` packs the five packages at that version and installs them into scratch projects with npm and with pnpm (`hoist=false`), from a local registry that serves them the way GitHub Packages does. It writes nothing outside the runner.
3. `publish` creates the annotated tag `vX.Y.Z`, publishes the five packages to GitHub Packages, and creates the GitHub release with the five release tarballs attached. The tag is created first. It records which commit the version belongs to, and every later run finishes that release instead of computing a new one.
4. `smoke` installs the published packages from GitHub Packages and bundles `import { Excalidraw }`.

To preview a release without writing anything, run it as a dry run:

```sh
gh workflow run semver-release.yml -R redaphid/excalidraw -f dry_run=true
```

To release a version you choose, pass it. It must be higher than the last release.

```sh
gh workflow run semver-release.yml -R redaphid/excalidraw -f version=2.0.0
```

To see the version and notes the workflow would compute, run the plan locally. `--offline` skips the GitHub release lookup.

```sh
node scripts/semver/plan.js --head=HEAD --offline --out=/tmp/plan
```

Pull requests that change the release scripts or the workflow run it as a dry run.

## How the version is chosen

The last release is the highest tag `vX.Y.Z` that is at least `v1.0.0` and was created by this workflow. The workflow marks its tags with the trailer `Release-Of: redaphid/excalidraw` in the tag message. Upstream's `v0.x` tags and the `v0.19.0-draw.N` tags are not releases. A tag that looks like a release but lacks the trailer stops the workflow, which names the tag.

The workflow reads every commit in `git log --no-merges <last tag>..HEAD`. On `master`, each pull request is one squash commit whose subject is the pull request's title, and the commits an upstream merge brings in count individually.

| Commit | Bump |
| --- | --- |
| `!` before the colon, as in `feat(editor)!: drop setViewport's legacy signature` | major |
| A body line that starts with `BREAKING CHANGE:` or `BREAKING-CHANGE:` | major |
| `feat`, as in `feat(editor): frames drawer` | minor |
| Any other subject, including `fix`, `perf`, `docs`, `ci` and subjects that are not conventional | patch |
| `chore: version the packages 0.19.0-draw.N` | none |

The release takes the largest bump among its commits. A minor bump resets the patch number, and a major bump resets both. With no release yet, the version is 1.0.0. If the only commits since the last release are draw version commits, there is nothing to release.

A tag that exists without a published GitHub release is an unfinished release. The next run finishes it at the commit the tag points at, even if `master` has moved, and refuses a `version` input that differs from it.

## Recover from a failed release

Every step checks what already exists before it acts, so you can rerun the failed jobs, or dispatch the workflow again. Neither publishes a version twice.

- If `build` fails, nothing was written. Fix the cause and dispatch again.
- If `publish` fails after the tag exists, rerun it or dispatch again. The run publishes the packages that are missing, then creates or finishes the GitHub release.
- If a run stops with `vX.Y.Z is claimed by <sha>`, someone created the tag by hand at another commit. Check that tag before you change anything. Never move it.
- If the tag exists but no package was published and the build at that commit keeps failing, delete the tag and dispatch again: `git push origin :refs/tags/vX.Y.Z`. Do this only while no package exists at that version, because GitHub Packages never accepts the same version twice.
- If `smoke` fails, the release is already published. Fix the problem in a new pull request and release a patch.

## The 0.19.0-draw.N releases

Before 1.0.0, the fork released `0.19.0-draw.N` tarballs attached to GitHub releases, and the draw app installs those by URL. That path still works while the draw app migrates. An admin commits `chore: version the packages 0.19.0-draw.N` (written by `node scripts/pack-draw-release.js --version=0.19.0-draw.N`) and pushes the annotated tag `v0.19.0-draw.N`, which runs `.github/workflows/release.yml`.

Each semver release attaches the same kind of tarballs, so a URL install can move to a semver release by changing the version in the URL:

```json
"@excalidraw/excalidraw": "https://github.com/redaphid/excalidraw/releases/download/v1.0.0/excalidraw-excalidraw-1.0.0.tgz"
```

The two paths share the `release` concurrency group, so their runs never overlap.
