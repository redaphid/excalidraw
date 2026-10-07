import { execFileSync, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

const slash = (file: string) => file.replace(/\\/g, "/");
const ROOT = slash(resolve(__dirname, "../.."));
const GUARD = `${ROOT}/scripts/check-no-npm-publish.sh`;

// On Windows the first bash.exe on PATH can be WSL's, which cannot read this
// tree, so use the bash that ships with Git for Windows.
const BASH =
  process.platform === "win32"
    ? resolve(
        execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
        "../../../bin/bash.exe",
      )
    : "bash";

const guard = (root: string) =>
  spawnSync(BASH, [GUARD, root], { encoding: "utf8" });

const CLEAN: Record<string, string> = {
  "package.json": '{ "name": "root", "private": true }\n',
  "packages/excalidraw/package.json":
    '{ "name": "@excalidraw/excalidraw", "publishConfig": { "access": "public" } }\n',
  ".npmrc": "save-exact=true\n",
  ".github/workflows/ci.yml": "permissions:\n  contents: read\n",
  ".github/workflows/semver-release.yml":
    "permissions:\n  contents: write\n  packages: write\n",
  "scripts/semver/publish.js":
    'run("npm publish x.tgz --registry=https://npm.pkg.github.com");\nnpm(ctx, ["publish", file]);\n',
  "scripts/semver/publish.test.ts":
    'const target = "https://registry.npmjs.org/"; // npm publish\n',
  "node_modules/left-pad/package.json":
    '{ "publishConfig": { "registry": "https://registry.npmjs.org/" } }\n',
};

const fixture = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "semver-guard-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return slash(root);
};

describe("check-no-npm-publish.sh", () => {
  it("passes the repository", () => {
    // Defect: the guard rejects the tree CI lints, so lint is always red.
    const result = guard(ROOT);
    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it("passes a tree whose only publish is in scripts/semver/publish.js", () => {
    // Defect: the allowlist forbids the one publisher, or scans tests and node_modules.
    const result = guard(fixture(CLEAN));
    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it.each([
    [
      "packages/excalidraw/package.json",
      '{ "publishConfig": { "registry": "https://registry.npmjs.org/" } }\n',
      "packages/excalidraw/package.json:1 R1",
    ],
    [".yarnrc", 'registry "https://registry.yarnpkg.com"\n', ".yarnrc:1 R1"],
    [
      ".github/workflows/ci.yml",
      "env:\n  NODE_AUTH_TOKEN: x\n",
      ".github/workflows/ci.yml:2 R2",
    ],
    [
      ".github/actions/setup/action.yml",
      "with:\n  registry-url: https://npm.pkg.github.com\n",
      ".github/actions/setup/action.yml:2 R2",
    ],
    [
      "scripts/release.js",
      'execSync("yarn publish --tag next");\n',
      "scripts/release.js:1 R3",
    ],
    [
      "scripts/semver/pack.js",
      'execFileSync("npm", ["publish", tarball]);\n',
      "scripts/semver/pack.js:1 R3",
    ],
    [
      ".github/workflows/release.yml",
      "steps:\n  - run: npm publish release/x.tgz\n",
      ".github/workflows/release.yml:2 R3",
    ],
    [
      ".github/workflows/ci.yml",
      "permissions:\n  packages: write\n",
      ".github/workflows/ci.yml:2 R4",
    ],
  ])("rejects %s with %j", (file, content, violation) => {
    // Defect: a path to npmjs, or a second publisher, gets past lint.
    const result = guard(fixture({ ...CLEAN, [file]: content }));
    expect(result.stdout).toContain(violation);
    expect(result.status).toBe(1);
  });
});
