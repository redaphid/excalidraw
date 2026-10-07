const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isDeepStrictEqual, parseArgs } = require("util");

const {
  GITHUB_REGISTRY,
  LOCKSTEP,
  PUBLISH_ORDER,
  registryName,
  sourceName,
} = require("./packages");
const { parseVersion, tagMessage } = require("./version");

const MAX_STEPS = 12;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const TAGGER = {
  name: "github-actions[bot]",
  email: "41898282+github-actions[bot]@users.noreply.github.com",
};

const publishViolations = (manifest, { id, version, sha }) => {
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
    manifest.gitHead === sha,
    `gitHead is ${manifest.gitHead}, not ${sha}`,
  );
  expect(
    manifest.publishConfig?.registry === GITHUB_REGISTRY,
    `publishConfig.registry is ${manifest.publishConfig?.registry}, not ${GITHUB_REGISTRY}`,
  );
  expect(
    !manifest.bundleDependencies && !manifest.bundledDependencies,
    "it bundles dependencies",
  );
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
      const sibling = LOCKSTEP.find(
        (other) => sourceName(other) === dependency,
      );
      const alias = sibling && `npm:${registryName(sibling)}@${version}`;
      expect(
        !sibling || spec === alias,
        `${field}.${dependency} is ${spec}, not ${alias}`,
      );
      expect(
        !String(spec).startsWith("npm:") ||
          String(spec).startsWith("npm:@redaphid/"),
        `${field}.${dependency} aliases ${spec}, outside @redaphid`,
      );
    }
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

const registryEntry = (artifact, id) =>
  artifact.registry.find((entry) => entry.id === id);

// Byte-identical, or rebuilt from the same commit by an earlier attempt.
const isOurs = (observed, entry, sha) =>
  observed.integrity === `sha512-${entry.sha512}` || observed.gitHead === sha;

const conflict = (reason) => ({ kind: "conflict", reason });

const nextStep = (observed, artifact) => {
  const { version, sha } = artifact;
  const tag = `v${version}`;
  const present = PUBLISH_ORDER.filter((id) => observed.packages[id]);
  if (observed.tag && observed.tag.sha !== sha) {
    return conflict(`${tag} is claimed by ${observed.tag.sha}, not ${sha}.`);
  }
  if (observed.release && !observed.release.draft) {
    return { kind: "done" };
  }
  if (!observed.tag && (present.length > 0 || observed.release)) {
    const leftovers = present.map((id) => `${registryName(id)}@${version}`);
    if (observed.release) {
      leftovers.push(`a draft ${tag} release`);
    }
    return conflict(
      `${tag} is not claimed, yet ${leftovers.join(
        ", ",
      )} exist. Delete them, or release another version.`,
    );
  }
  if (!observed.tag) {
    return { kind: "claim" };
  }
  const stranger = present.find(
    (id) => !isOurs(observed.packages[id], registryEntry(artifact, id), sha),
  );
  if (stranger) {
    return conflict(
      `${registryName(stranger)}@${version} was not built from ${sha}.`,
    );
  }
  const missing = PUBLISH_ORDER.find((id) => !observed.packages[id]);
  if (missing) {
    return { kind: "publish", id: missing };
  }
  if (!observed.release) {
    return { kind: "draft" };
  }
  const files = artifact.assets
    .map((asset) => asset.file)
    .filter((file) => !observed.release.assets.includes(path.basename(file)));
  if (files.length > 0) {
    return { kind: "upload", files };
  }
  return { kind: "undraft" };
};

const failed = (what, result) =>
  new Error(
    `${what} failed (exit ${result.status}): ${
      result.stderr.trim() || result.stdout.trim()
    }`,
  );

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const gh = (ctx, args, input) => {
  const result = ctx.io.run("gh", args, { input });
  if (result.status !== 0) {
    throw failed(`gh ${args.slice(0, 3).join(" ")}`, result);
  }
  return parseJson(result.stdout);
};

// npm must not inherit a registry or a token from the runner, so its only
// config is the userconfig written here plus the flags below.
const npm = (ctx, args) =>
  ctx.io.run(
    "npm",
    [
      ...args,
      `--registry=${GITHUB_REGISTRY}`,
      `--@redaphid:registry=${GITHUB_REGISTRY}`,
      `--userconfig=${ctx.userconfig}`,
      "--ignore-scripts",
    ],
    {
      cwd: ctx.workdir,
      env: Object.fromEntries(
        Object.entries(ctx.io.env).filter(
          ([key]) =>
            !/^npm_config_/i.test(key) &&
            key !== "NODE_AUTH_TOKEN" &&
            key !== "NPM_TOKEN",
        ),
      ),
    },
  );

const observeTag = (ctx) => {
  const result = ctx.io.run("gh", [
    "api",
    `repos/${ctx.repo}/git/ref/tags/${ctx.tag}`,
  ]);
  if (result.status !== 0) {
    if (/HTTP 404/.test(result.stderr)) {
      return null;
    }
    throw failed(`Looking up ${ctx.tag}`, result);
  }
  const { object } = JSON.parse(result.stdout);
  if (object.type !== "tag") {
    return { sha: object.sha };
  }
  return {
    sha: gh(ctx, ["api", `repos/${ctx.repo}/git/tags/${object.sha}`]).object
      .sha,
  };
};

const observePackage = (ctx, id) => {
  const spec = `${registryName(id)}@${ctx.artifact.version}`;
  // The whole manifest, because `npm view <spec> a b` prints a bare value
  // instead of an object when one of the two fields is missing.
  const result = npm(ctx, ["view", spec, "--json"]);
  const view = parseJson(result.stdout);
  if (result.status === 0 && view?.version === ctx.artifact.version) {
    return {
      integrity: view.dist?.integrity ?? null,
      gitHead: view.gitHead ?? null,
    };
  }
  if (result.status !== 0 && view?.error?.code === "E404") {
    return null;
  }
  throw failed(`npm view ${spec}`, result);
};

const observeRelease = (ctx) => {
  const result = ctx.io.run("gh", [
    "release",
    "view",
    ctx.tag,
    "--repo",
    ctx.repo,
    "--json",
    "isDraft,assets",
  ]);
  if (result.status !== 0) {
    if (/release not found/.test(result.stderr)) {
      return null;
    }
    throw failed(`gh release view ${ctx.tag}`, result);
  }
  const release = JSON.parse(result.stdout);
  return {
    draft: release.isDraft,
    assets: release.assets.map((asset) => asset.name).sort(),
  };
};

const observe = (ctx) => ({
  tag: observeTag(ctx),
  packages: Object.fromEntries(
    PUBLISH_ORDER.map((id) => [id, observePackage(ctx, id)]),
  ),
  release: observeRelease(ctx),
});

const EXECUTE = {
  claim: (ctx) => {
    const { sha } = ctx.artifact;
    const tagObject = gh(
      ctx,
      ["api", `repos/${ctx.repo}/git/tags`, "--method", "POST", "--input", "-"],
      JSON.stringify({
        tag: ctx.tag,
        message: tagMessage(ctx.notes),
        object: sha,
        type: "commit",
        tagger: TAGGER,
      }),
    );
    const ref = ctx.io.run(
      "gh",
      ["api", `repos/${ctx.repo}/git/refs`, "--method", "POST", "--input", "-"],
      {
        input: JSON.stringify({
          ref: `refs/tags/${ctx.tag}`,
          sha: tagObject.sha,
        }),
      },
    );
    // 422: another run created the ref first. The next observation decides
    // whether that claim is ours.
    if (ref.status !== 0 && !/HTTP 422/.test(ref.stderr)) {
      throw failed(`Creating refs/tags/${ctx.tag}`, ref);
    }
    return `Claimed ${ctx.tag} at ${sha}.`;
  },
  publish: (ctx, step) => {
    const entry = registryEntry(ctx.artifact, step.id);
    const result = npm(ctx, ["publish", path.join(ctx.dir, entry.file)]);
    if (result.status !== 0) {
      throw failed(`Publishing ${entry.file}`, result);
    }
    return `Published ${registryName(step.id)}@${ctx.artifact.version}.`;
  },
  draft: (ctx) => {
    gh(ctx, [
      "release",
      "create",
      ctx.tag,
      "--repo",
      ctx.repo,
      "--draft",
      "--verify-tag",
      "--title",
      ctx.artifact.version,
      "--notes-file",
      ctx.notesFile,
    ]);
    return `Drafted the ${ctx.tag} release.`;
  },
  upload: (ctx, step) => {
    gh(ctx, [
      "release",
      "upload",
      ctx.tag,
      "--repo",
      ctx.repo,
      "--clobber",
      ...step.files.map((file) => path.join(ctx.dir, file)),
    ]);
    return `Attached ${step.files
      .map((file) => path.basename(file))
      .join(", ")}.`;
  },
  undraft: (ctx) => {
    gh(ctx, [
      "release",
      "edit",
      ctx.tag,
      "--repo",
      ctx.repo,
      "--draft=false",
      "--latest",
    ]);
    return `Published the ${ctx.tag} release.`;
  },
};

const sha512Of = (file) =>
  crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");

const loadArtifact = (dir) => {
  const artifact = JSON.parse(
    fs.readFileSync(path.join(dir, "artifact.json"), "utf8"),
  );
  parseVersion(artifact.version);
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(artifact.sha)) {
    problems.push(`sha ${artifact.sha} is not a full commit sha`);
  }
  const ids = artifact.registry.map((entry) => entry.id);
  if ([...ids].sort().join() !== [...LOCKSTEP].sort().join()) {
    problems.push(`the registry tarballs are for ${ids.join(", ")}`);
  }
  for (const entry of [...artifact.assets, ...artifact.registry]) {
    if (sha512Of(path.join(dir, entry.file)) !== entry.sha512) {
      problems.push(`${entry.file} does not match its sha512`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Refusing ${dir}/artifact.json: ${problems.join("; ")}.`);
  }
  return artifact;
};

const readManifest = (io, file) => {
  const result = io.run("tar", ["-xzOf", file, "package/package.json"]);
  if (result.status !== 0) {
    throw failed(`Reading the manifest in ${file}`, result);
  }
  return JSON.parse(result.stdout);
};

const main = (io) => {
  const { values } = parseArgs({
    args: io.argv,
    options: {
      dir: { type: "string", default: "release" },
      notes: { type: "string" },
    },
  });
  const repo = io.env.GITHUB_REPOSITORY;
  if (!values.notes || !repo || !io.env.GITHUB_TOKEN) {
    throw new Error(
      "Usage: GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> node scripts/semver/publish.js --dir=release --notes=<file>",
    );
  }
  const dir = path.resolve(values.dir);
  const artifact = loadArtifact(dir);
  for (const entry of artifact.registry) {
    assertPublishable(readManifest(io, path.join(dir, entry.file)), {
      id: entry.id,
      version: artifact.version,
      sha: artifact.sha,
    });
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "semver-publish-"));
  const userconfig = path.join(workdir, "npmrc");
  // A literal reference that npm expands, so the token never lands on disk.
  fs.writeFileSync(
    userconfig,
    `//${new URL(GITHUB_REGISTRY).host}/:_authToken=\${GITHUB_TOKEN}\n`,
  );
  const ctx = {
    io,
    repo,
    dir,
    artifact,
    tag: `v${artifact.version}`,
    notes: fs.readFileSync(values.notes, "utf8").trim(),
    notesFile: path.resolve(values.notes),
    workdir,
    userconfig,
  };
  const report = (line) => {
    console.info(line);
    if (io.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(io.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
    }
  };

  try {
    let previous = null;
    for (let attempt = 0; attempt < MAX_STEPS; attempt++) {
      const observed = observe(ctx);
      if (previous && isDeepStrictEqual(observed, previous.observed)) {
        throw new Error(
          `The ${previous.step.kind} step did not take effect: nothing changed.`,
        );
      }
      const step = nextStep(observed, artifact);
      if (step.kind === "done") {
        report(`${ctx.tag} is released.`);
        return;
      }
      if (step.kind === "conflict") {
        throw new Error(step.reason);
      }
      report(EXECUTE[step.kind](ctx, step));
      previous = { observed, step };
    }
    throw new Error(`${ctx.tag} did not finish within ${MAX_STEPS} steps.`);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
};

const spawnRunner = (command, args, { input, cwd, env } = {}) => {
  const result = spawnSync(command, args, {
    input,
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

if (require.main === module) {
  try {
    main({ argv: process.argv.slice(2), env: process.env, run: spawnRunner });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { assertPublishable, main, nextStep };
