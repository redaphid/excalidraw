import { createHash } from "crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import {
  GITHUB_REGISTRY,
  LOCKSTEP,
  PUBLISH_ORDER,
  registryName,
} from "./packages";
import { assertPublishable, main, nextStep } from "./publish";
import { TRAILER } from "./version";

const VERSION = "1.0.0";
const SHA = "5".repeat(40);
const OTHER_SHA = "9".repeat(40);
const REPO = "redaphid/excalidraw";

type Manifest = Record<string, any>;
type RunOptions = {
  input?: string;
  cwd?: string;
  env?: Record<string, string>;
};
type Call = { cmd: string; args: string[]; options: RunOptions };

const manifestFor = (id: string): Manifest => ({
  name: registryName(id),
  version: VERSION,
  gitHead: SHA,
  publishConfig: { registry: GITHUB_REGISTRY },
  dependencies:
    id === "excalidraw"
      ? {
          "@excalidraw/common": `npm:@redaphid/excalidraw-common@${VERSION}`,
          clsx: "1.1.1",
        }
      : {},
});

const sha512 = (bytes: Buffer | string) =>
  createHash("sha512").update(bytes).digest("base64");

const artifactFor = (hash: (file: string) => string) => {
  const entry = (id: string, file: string) => ({
    id,
    file,
    sha512: hash(file),
  });
  return {
    version: VERSION,
    sha: SHA,
    assets: LOCKSTEP.map((id) => entry(id, `excalidraw-${id}-${VERSION}.tgz`)),
    registry: LOCKSTEP.map((id) => ({
      ...entry(id, `registry/redaphid-excalidraw-${id}-${VERSION}.tgz`),
      name: registryName(id),
    })),
  };
};

const ARTIFACT = artifactFor((file) => `digest-of-${file}`);
const registryFile = (id: string) =>
  ARTIFACT.registry.find((entry) => entry.id === id)!.file;
const ours = (id: string) => ({
  integrity: `sha512-digest-of-${registryFile(id)}`,
  gitHead: SHA,
});
const packages = (ids: readonly string[]) =>
  Object.fromEntries(
    PUBLISH_ORDER.map((id) => [id, ids.includes(id) ? ours(id) : null]),
  );
const assetNames = (count: number) =>
  ARTIFACT.assets
    .slice(0, count)
    .map((asset) => asset.file)
    .sort();

const world = (overrides: Record<string, unknown>) => ({
  tag: null,
  packages: packages([]),
  release: null,
  ...overrides,
});

describe("nextStep", () => {
  const claimed = { tag: { sha: SHA } };

  it.each([
    ["nothing exists", world({}), { kind: "claim" }],
    [
      "the claim crashed before publishing",
      world(claimed),
      { kind: "publish", id: "fractional-indexing" },
    ],
    [
      "two packages published before a crash",
      world({
        ...claimed,
        packages: packages(["fractional-indexing", "math"]),
      }),
      { kind: "publish", id: "common" },
    ],
    [
      "a package rebuilt from the same commit with other bytes",
      world({
        ...claimed,
        packages: {
          ...packages(["fractional-indexing"]),
          "fractional-indexing": { integrity: "sha512-other", gitHead: SHA },
        },
      }),
      { kind: "publish", id: "math" },
    ],
    [
      "a byte-identical package without a gitHead",
      world({
        ...claimed,
        packages: {
          ...packages(["fractional-indexing"]),
          "fractional-indexing": {
            ...ours("fractional-indexing"),
            gitHead: null,
          },
        },
      }),
      { kind: "publish", id: "math" },
    ],
    [
      "all packages published before a crash",
      world({ ...claimed, packages: packages(PUBLISH_ORDER) }),
      { kind: "draft" },
    ],
    [
      "the draft crashed before any upload",
      world({
        ...claimed,
        packages: packages(PUBLISH_ORDER),
        release: { draft: true, assets: [] },
      }),
      { kind: "upload", files: ARTIFACT.assets.map((asset) => asset.file) },
    ],
    [
      "the upload crashed after two assets",
      world({
        ...claimed,
        packages: packages(PUBLISH_ORDER),
        release: { draft: true, assets: assetNames(2) },
      }),
      {
        kind: "upload",
        files: ARTIFACT.assets.slice(2).map((asset) => asset.file),
      },
    ],
    [
      "every asset is on the draft",
      world({
        ...claimed,
        packages: packages(PUBLISH_ORDER),
        release: { draft: true, assets: assetNames(5) },
      }),
      { kind: "undraft" },
    ],
    [
      "the release is published",
      world({
        ...claimed,
        packages: packages(PUBLISH_ORDER),
        release: { draft: false, assets: assetNames(5) },
      }),
      { kind: "done" },
    ],
  ])("when %s", (_, observed, step) => {
    // Defect: a resumed run repeats a write, skips one, or stops early.
    expect(nextStep(observed, ARTIFACT)).toEqual(step);
  });

  it.each([
    [
      "the tag points at another commit",
      world({ tag: { sha: OTHER_SHA } }),
      /claimed by 9{40}/,
    ],
    [
      "the tag points at another commit and its release is out",
      world({ tag: { sha: OTHER_SHA }, release: { draft: false, assets: [] } }),
      /claimed by 9{40}/,
    ],
    [
      "a package exists without a claim",
      world({ packages: packages(["math"]) }),
      /not claimed.*excalidraw-math@1\.0\.0/,
    ],
    [
      "a draft exists without a claim",
      world({ release: { draft: true, assets: [] } }),
      /not claimed.*draft v1\.0\.0/,
    ],
    [
      "a package was built from another commit",
      world({
        tag: { sha: SHA },
        packages: {
          ...packages([]),
          math: { integrity: "sha512-x", gitHead: OTHER_SHA },
        },
      }),
      /@redaphid\/excalidraw-math@1\.0\.0 was not built from 5{40}/,
    ],
  ])("stops when %s", (_, observed, reason) => {
    // Defect: the run publishes on top of someone else's version.
    const step = nextStep(observed, ARTIFACT);
    expect(step.kind).toBe("conflict");
    expect(step.reason).toMatch(reason);
  });
});

describe("assertPublishable", () => {
  const expected = { id: "excalidraw", version: VERSION, sha: SHA };
  const mutate = (change: (manifest: Manifest) => void) => {
    const manifest = manifestFor("excalidraw");
    change(manifest);
    return () => assertPublishable(manifest, expected);
  };

  it("accepts the registry manifest", () => {
    expect(mutate(() => {})).not.toThrow();
  });

  it.each<[string, (manifest: Manifest) => void, RegExp]>([
    [
      "a publishConfig that targets npmjs",
      (m) => (m.publishConfig.registry = "https://registry.npmjs.org/"),
      /publishConfig\.registry is https:\/\/registry\.npmjs\.org/,
    ],
    [
      "a missing publishConfig",
      (m) => delete m.publishConfig,
      /publishConfig\.registry is undefined/,
    ],
    [
      "the upstream name",
      (m) => (m.name = "@excalidraw/excalidraw"),
      /name is @excalidraw\/excalidraw/,
    ],
    [
      "a plain-range internal dependency",
      (m) => (m.dependencies["@excalidraw/common"] = VERSION),
      /dependencies\.@excalidraw\/common is 1\.0\.0/,
    ],
    [
      "an alias outside @redaphid",
      (m) => (m.dependencies["left-pad"] = "npm:evil-pad@1.0.0"),
      /aliases npm:evil-pad@1\.0\.0/,
    ],
    [
      "bundled dependencies",
      (m) => (m.bundleDependencies = ["@excalidraw/common"]),
      /bundles/,
    ],
    [
      "another commit's gitHead",
      (m) => (m.gitHead = OTHER_SHA),
      /gitHead is 9{40}/,
    ],
  ])("refuses %s", (_, change, reason) => {
    // Defect: a tarball that could reach npmjs, or the wrong package, ships.
    expect(mutate(change)).toThrow(reason);
  });
});

const isPublishCall = ({ cmd, args }: Call) =>
  cmd === "npm" && args[0] === "publish";
const isGitHubWrite = ({ cmd, args }: Call) =>
  cmd === "gh" &&
  (args.includes("POST") || ["create", "upload", "edit"].includes(args[1]));

const setup = (manifests: Record<string, Manifest> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "semver-publish-test-"));
  mkdirSync(join(dir, "registry"));
  const artifact = artifactFor((file) => {
    writeFileSync(join(dir, file), `tarball ${file}`);
    return sha512(`tarball ${file}`);
  });
  writeFileSync(join(dir, "artifact.json"), JSON.stringify(artifact));
  writeFileSync(join(dir, "notes.md"), "First semver release.\n");
  const manifestByFile = new Map(
    artifact.registry.map((entry) => [
      basename(entry.file),
      manifests[entry.id] ?? manifestFor(entry.id),
    ]),
  );

  const state = {
    tag: null as string | null,
    tagMessage: "",
    tagObjects: new Map<string, string>(),
    packages: new Map<string, { integrity: string; gitHead: string }>(),
    release: null as null | { draft: boolean; assets: string[] },
    failPublish: null as null | string,
    publishIsLost: false,
    viewsBeforeVisible: 0,
    hidden: new Map<string, number>(),
  };
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const npmrcSeen: string[] = [];
  const ok = (value?: unknown) => ({
    status: 0,
    stdout: value === undefined ? "" : JSON.stringify(value),
    stderr: "",
  });
  const fail = (stderr: string, stdout = "") => ({ status: 1, stdout, stderr });

  const run = (cmd: string, args: string[], options: RunOptions = {}) => {
    calls.push({ cmd, args, options });
    const [verb, target] = args;
    if (cmd === "tar") {
      return ok(manifestByFile.get(basename(target)));
    }
    if (cmd === "npm") {
      const userconfig = args.find((arg) => arg.startsWith("--userconfig="))!;
      npmrcSeen.push(readFileSync(userconfig.split("=")[1], "utf8"));
    }
    if (cmd === "npm" && verb === "view") {
      const name = target.slice(0, target.lastIndexOf("@"));
      const hiddenViews = state.hidden.get(name) ?? 0;
      state.hidden.set(name, hiddenViews - 1);
      const pkg = hiddenViews > 0 ? undefined : state.packages.get(name);
      return pkg
        ? ok({
            version: VERSION,
            dist: { integrity: pkg.integrity },
            gitHead: pkg.gitHead,
          })
        : fail(
            "npm error code E404",
            JSON.stringify({ error: { code: "E404" } }),
          );
    }
    if (cmd === "npm" && verb === "publish") {
      const manifest = manifestByFile.get(basename(target))!;
      if (manifest.name === state.failPublish) {
        return fail("npm error network ECONNRESET");
      }
      if (!state.publishIsLost) {
        state.hidden.set(manifest.name, state.viewsBeforeVisible);
        state.packages.set(manifest.name, {
          integrity: `sha512-${sha512(readFileSync(target))}`,
          gitHead: manifest.gitHead,
        });
      }
      return ok();
    }
    if (cmd === "gh" && verb === "api") {
      const body = options.input ? JSON.parse(options.input) : null;
      if (target.endsWith("/git/tags") && body) {
        state.tagObjects.set("tag-object", body.object);
        state.tagMessage = body.message;
        return ok({ sha: "tag-object" });
      }
      if (target.endsWith("/git/refs") && body) {
        if (state.tag) {
          return fail("gh: Reference already exists (HTTP 422)");
        }
        state.tag = state.tagObjects.get(body.sha)!;
        return ok({});
      }
      if (target.endsWith(`/git/ref/tags/v${VERSION}`)) {
        return state.tag
          ? ok({ object: { type: "tag", sha: "tag-object" } })
          : fail("gh: Not Found (HTTP 404)");
      }
      if (target.endsWith("/git/tags/tag-object")) {
        return ok({ object: { type: "commit", sha: state.tag } });
      }
    }
    if (cmd === "gh" && verb === "release") {
      if (target === "view") {
        return state.release
          ? ok({
              isDraft: state.release.draft,
              assets: state.release.assets.map((name) => ({ name })),
            })
          : fail("release not found");
      }
      if (target === "create") {
        state.release = { draft: true, assets: [] };
        return ok();
      }
      if (target === "upload") {
        const files = args.filter((arg) => arg.endsWith(".tgz"));
        state.release!.assets.push(...files.map((file) => basename(file)));
        return ok();
      }
      if (target === "edit") {
        state.release!.draft = false;
        return ok();
      }
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
  };

  const io = {
    argv: [`--dir=${dir}`, `--notes=${join(dir, "notes.md")}`],
    env: {
      PATH: process.env.PATH ?? "",
      GITHUB_TOKEN: "secret-token",
      GITHUB_REPOSITORY: REPO,
      NPM_TOKEN: "npmjs-token",
      NODE_AUTH_TOKEN: "npmjs-token",
      npm_config_registry: "https://registry.npmjs.org/",
      NPM_CONFIG__AUTH: "npmjs-auth",
    },
    run,
    sleep: (ms: number) => {
      sleeps.push(ms);
    },
  };
  return { dir, artifact, state, calls, npmrcSeen, sleeps, io };
};

const attempt = (run: () => void) => {
  try {
    run();
    return "completed";
  } catch (error) {
    return String(error);
  }
};

describe("main", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("publishes and tags nothing when one of five tarballs targets npmjs", () => {
    // Defect: the guard runs after (or instead of) the first registry write.
    const math = manifestFor("math");
    math.publishConfig.registry = "https://registry.npmjs.org/";
    const { calls, io } = setup({ math });

    const outcome = attempt(() => main(io));

    expect(calls.filter(isPublishCall)).toEqual([]);
    expect(calls.filter(isGitHubWrite)).toEqual([]);
    expect(outcome).toMatch(/Refusing to publish @redaphid\/excalidraw-math/);
  });

  it("refuses a tarball that does not match artifact.json", () => {
    // Defect: a swapped tarball is published under a verified artifact.
    const { dir, artifact, calls, io } = setup();
    writeFileSync(join(dir, artifact.registry[0].file), "tampered");

    expect(() => main(io)).toThrow(/does not match its sha512/);
    expect(calls).toEqual([]);
  });

  it("publishes in order, releases, and a re-run writes nothing", () => {
    // Defect: a re-run of a finished release publishes or tags again.
    const { state, calls, io } = setup();

    main(io);

    expect(state.tag).toBe(SHA);
    expect(state.tagMessage).toBe(`First semver release.\n\n${TRAILER}\n`);
    expect(
      calls.filter(isPublishCall).map((call) => basename(call.args[1])),
    ).toEqual(
      PUBLISH_ORDER.map((id) => `redaphid-excalidraw-${id}-${VERSION}.tgz`),
    );
    expect(state.release).toEqual({
      draft: false,
      assets: ARTIFACT.assets.map((asset) => asset.file),
    });

    calls.length = 0;
    main(io);
    expect(
      calls.filter((call) => isPublishCall(call) || isGitHubWrite(call)),
    ).toEqual([]);
  });

  it("resumes after a crash without publishing a package twice", () => {
    // Defect: a re-run republishes what the crashed run already published.
    const { state, calls, io } = setup();
    state.failPublish = registryName("common");
    expect(() => main(io)).toThrow(/ECONNRESET/);

    state.failPublish = null;
    main(io);

    expect(
      calls.filter(isPublishCall).map((call) => basename(call.args[1])),
    ).toEqual(
      [
        "fractional-indexing",
        "math",
        "common",
        "common",
        "element",
        "excalidraw",
      ].map((id) => `redaphid-excalidraw-${id}-${VERSION}.tgz`),
    );
    expect(state.release?.draft).toBe(false);
  });

  it("runs npm against GitHub Packages only, without inherited npm config or tokens", () => {
    // Defect: a runner token or npm_config_registry sends a package to npmjs.
    const { calls, npmrcSeen, io } = setup();
    main(io);

    const npmCalls = calls.filter((call) => call.cmd === "npm");
    expect(npmCalls.length).toBeGreaterThan(0);
    for (const { args, options } of npmCalls) {
      expect(args).toEqual(
        expect.arrayContaining([
          `--registry=${GITHUB_REGISTRY}`,
          `--@redaphid:registry=${GITHUB_REGISTRY}`,
          "--ignore-scripts",
        ]),
      );
      expect(
        Object.keys(options.env!).filter((key) =>
          /npm_config_|NODE_AUTH_TOKEN|NPM_TOKEN/i.test(key),
        ),
      ).toEqual([]);
      expect(options.env!.GITHUB_TOKEN).toBe("secret-token");
    }
    expect(new Set(npmrcSeen)).toEqual(
      new Set([`//npm.pkg.github.com/:_authToken=\${GITHUB_TOKEN}\n`]),
    );
  });

  it("waits for a slow registry to show a publish instead of failing", () => {
    // Defect: a propagation delay fails the release, or republishes a version.
    const { state, calls, sleeps, io } = setup();
    state.viewsBeforeVisible = 1;

    main(io);

    expect(calls.filter(isPublishCall)).toHaveLength(5);
    expect(sleeps).toEqual(Array(5).fill(10_000));
    expect(state.release?.draft).toBe(false);
  });

  it("stops when a step never changes what it observes", () => {
    // Defect: a publish that silently did nothing loops or reports success.
    const { state, calls, sleeps, io } = setup();
    state.publishIsLost = true;

    expect(() => main(io)).toThrow(
      /publish step did not take effect: nothing changed after 6 looks/,
    );
    expect(calls.filter(isPublishCall)).toHaveLength(1);
    expect(sleeps).toHaveLength(5);
  });
});
