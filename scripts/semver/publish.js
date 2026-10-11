const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  GITHUB_REGISTRY,
  LOCKSTEP,
  PUBLISH_ORDER,
  registryName,
  sourceName,
} = require("./packages");

const publishViolations = (manifest, { id, version }) => {
  const violations = [];
  const expect = (ok, problem) => ok || violations.push(problem);
  expect(
    manifest.name === registryName(id),
    `name is ${manifest.name}, not ${registryName(id)}`,
  );
  expect(
    manifest.version === version,
    `version is ${manifest.version}, not ${version}`,
  );
  expect(
    manifest.publishConfig?.registry === GITHUB_REGISTRY,
    `publishConfig.registry is ${manifest.publishConfig?.registry}, not ${GITHUB_REGISTRY}`,
  );
  expect(
    !manifest.bundleDependencies && !manifest.bundledDependencies,
    "it bundles dependencies",
  );
  for (const [dependency, spec] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    const sibling = LOCKSTEP.find((other) => sourceName(other) === dependency);
    const alias = sibling && `npm:${registryName(sibling)}@${version}`;
    expect(
      !sibling || spec === alias,
      `dependencies.${dependency} is ${spec}, not ${alias}`,
    );
  }
  return violations;
};

const assertPublishable = (manifest, expected) => {
  const violations = publishViolations(manifest, expected);
  if (violations.length > 0) {
    throw new Error(
      `Refusing to publish ${registryName(expected.id)}: ${violations.join(
        "; ",
      )}.`,
    );
  }
};

const failed = (what, result) =>
  new Error(
    `${what} failed (exit ${result.status}): ${
      result.stderr.trim() || result.stdout.trim()
    }`,
  );

// Checks all five tarballs before publishing any, publishes in dependency
// order, and skips a version the registry already has, so a rerun after a
// failure publishes only what is missing.
const publish = ({ version, dir, run, dryRun = false }) => {
  const tarball = (id) =>
    path.join(dir, `redaphid-excalidraw-${id}-${version}.tgz`);
  for (const id of PUBLISH_ORDER) {
    // A bare name inside dir: GNU tar reads "D:\..." as a remote host and
    // unescapes "\r" in a Windows path.
    const result = run(
      "tar",
      ["-xzOf", path.basename(tarball(id)), "package/package.json"],
      { cwd: dir },
    );
    if (result.status !== 0) {
      throw failed(`Reading the manifest in ${tarball(id)}`, result);
    }
    assertPublishable(JSON.parse(result.stdout), { id, version });
  }

  const userconfig = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "publish-")),
    "npmrc",
  );
  fs.writeFileSync(
    userconfig,
    `//${new URL(GITHUB_REGISTRY).host}/:_authToken=\${GITHUB_TOKEN}\n`,
  );
  const npm = (args) =>
    run("npm", [
      ...args,
      `--registry=${GITHUB_REGISTRY}`,
      `--userconfig=${userconfig}`,
    ]);

  for (const id of PUBLISH_ORDER) {
    const spec = `${registryName(id)}@${version}`;
    if (dryRun) {
      const result = npm(["publish", tarball(id), "--dry-run"]);
      if (result.status !== 0) {
        throw failed(`Dry-run publishing ${spec}`, result);
      }
      console.info(`Would publish ${spec}.`);
      continue;
    }
    if (npm(["view", spec, "version"]).stdout.trim() === version) {
      console.info(`${spec} is already published.`);
      continue;
    }
    const result = npm(["publish", tarball(id)]);
    if (result.status !== 0) {
      throw failed(`Publishing ${spec}`, result);
    }
    console.info(`Published ${spec}.`);
  }
};

if (require.main === module) {
  const version = process.argv
    .find((argument) => argument.startsWith("--version="))
    ?.split("=")[1];
  const dryRun = process.argv.includes("--dry-run");
  if (!version || (!dryRun && !process.env.GITHUB_TOKEN)) {
    console.error(
      "Usage: GITHUB_TOKEN=<token> node scripts/semver/publish.js --version=1.0.0 [--dry-run]",
    );
    process.exit(1);
  }
  try {
    publish({
      version,
      dir: path.resolve(__dirname, "../../release/registry"),
      dryRun,
      run: (command, args, options) =>
        spawnSync(command, args, {
          ...options,
          // npm is npm.cmd on Windows, which only a shell can start.
          shell: process.platform === "win32" && command === "npm",
          encoding: "utf8",
          maxBuffer: 1 << 26,
        }),
    });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { assertPublishable, publish };
