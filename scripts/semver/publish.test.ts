import { basename } from "path";

import { GITHUB_REGISTRY, PUBLISH_ORDER, registryName } from "./packages";
import { assertPublishable, publish } from "./publish";

const VERSION = "1.0.0";

type Manifest = Record<string, any>;

const manifestFor = (id: string): Manifest => ({
  name: registryName(id),
  version: VERSION,
  publishConfig: { registry: GITHUB_REGISTRY },
  dependencies:
    id === "excalidraw"
      ? {
          "@excalidraw/common": `npm:@redaphid/excalidraw-common@${VERSION}`,
          clsx: "1.1.1",
        }
      : {},
});

describe("assertPublishable", () => {
  const expected = { id: "excalidraw", version: VERSION };
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
      "another version",
      (m) => (m.version = "0.19.0-draw.22"),
      /version is 0\.19\.0-draw\.22/,
    ],
    [
      "a plain-range internal dependency",
      (m) => (m.dependencies["@excalidraw/common"] = VERSION),
      /dependencies\.@excalidraw\/common is 1\.0\.0/,
    ],
    [
      "bundled dependencies",
      (m) => (m.bundleDependencies = ["@excalidraw/common"]),
      /bundles/,
    ],
  ])("refuses %s", (_, change, reason) => {
    // Defect: a tarball that could reach npmjs, or the wrong package, ships.
    expect(mutate(change)).toThrow(reason);
  });
});

describe("publish", () => {
  const registry = (published: string[], manifests: Manifest = {}) => {
    const calls: string[][] = [];
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (cmd === "tar") {
        const id = PUBLISH_ORDER.find((each) =>
          basename(args[1]).startsWith(`redaphid-excalidraw-${each}-`),
        )!;
        return {
          status: 0,
          stdout: JSON.stringify(manifests[id] ?? manifestFor(id)),
          stderr: "",
        };
      }
      if (args[0] === "view") {
        const name = args[1].slice(0, args[1].lastIndexOf("@"));
        return published.includes(name)
          ? { status: 0, stdout: `${VERSION}\n`, stderr: "" }
          : { status: 1, stdout: "", stderr: "npm error code E404" };
      }
      published.push(
        registryName(
          PUBLISH_ORDER.find((id) =>
            basename(args[1]).startsWith(`redaphid-excalidraw-${id}-`),
          )!,
        ),
      );
      return { status: 0, stdout: "", stderr: "" };
    };
    const publishes = () =>
      calls
        .filter(([cmd, verb]) => cmd === "npm" && verb === "publish")
        .map((call) => basename(call[2]));
    return { run, calls, publishes };
  };

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("publishes in dependency order to GitHub Packages only", () => {
    // Defect: a dependent lands before its dependency, or npm targets npmjs.
    const { run, calls, publishes } = registry([]);
    publish({ version: VERSION, dir: "release/registry", run });

    expect(publishes()).toEqual(
      PUBLISH_ORDER.map((id) => `redaphid-excalidraw-${id}-${VERSION}.tgz`),
    );
    for (const call of calls.filter(([cmd]) => cmd === "npm")) {
      expect(call).toContain(`--registry=${GITHUB_REGISTRY}`);
    }
  });

  it("publishes only what a failed run left missing", () => {
    // Defect: a rerun republishes a version, which the registry rejects.
    const { run, publishes } = registry([
      registryName("fractional-indexing"),
      registryName("math"),
    ]);
    publish({ version: VERSION, dir: "release/registry", run });

    expect(publishes()).toEqual(
      ["common", "element", "excalidraw"].map(
        (id) => `redaphid-excalidraw-${id}-${VERSION}.tgz`,
      ),
    );
  });

  it("dry-runs every package without checking or writing the registry", () => {
    // Defect: the CI dry run publishes for real, or skips a package.
    const { run, calls } = registry([registryName("math")]);
    publish({ version: VERSION, dir: "release/registry", run, dryRun: true });

    const npmCalls = calls.filter(([cmd]) => cmd === "npm");
    expect(npmCalls.map((call) => call[1])).toEqual(
      PUBLISH_ORDER.map(() => "publish"),
    );
    for (const call of npmCalls) {
      expect(call).toContain("--dry-run");
    }
  });

  it("publishes nothing when one tarball targets npmjs", () => {
    // Defect: the guard runs after the first publish.
    const math = manifestFor("math");
    math.publishConfig.registry = "https://registry.npmjs.org/";
    const { run, publishes } = registry([], { math });

    expect(() =>
      publish({ version: VERSION, dir: "release/registry", run }),
    ).toThrow(/Refusing to publish @redaphid\/excalidraw-math/);
    expect(publishes()).toEqual([]);
  });
});
