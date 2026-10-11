import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  declarationTarget,
  GITHUB_REGISTRY,
  registryManifest,
  siblingClosure,
  urlManifest,
} = require("./packages.js");

const DRAW = "0.19.0-draw.21";
const SHA = "9ae2769c3f00d45f7a0a753946dcfceb5abce8f3";

const packed = {
  common: {
    name: "@excalidraw/common",
    version: DRAW,
    dependencies: { tinycolor2: "1.6.0", "@excalidraw/math": DRAW },
    publishConfig: { access: "public" },
    repository: "https://github.com/excalidraw/excalidraw",
  },
  "fractional-indexing": {
    name: "@excalidraw/fractional-indexing",
    version: DRAW,
    publishConfig: { access: "public" },
    repository: "https://github.com/excalidraw/excalidraw",
  },
  math: {
    name: "@excalidraw/math",
    version: DRAW,
    dependencies: { "@excalidraw/common": DRAW },
    publishConfig: { access: "public" },
    repository: "https://github.com/excalidraw/excalidraw",
  },
  element: {
    name: "@excalidraw/element",
    version: DRAW,
    dependencies: {
      "@excalidraw/common": DRAW,
      "@excalidraw/math": DRAW,
      "@excalidraw/fractional-indexing": DRAW,
    },
    publishConfig: { access: "public" },
    repository: "https://github.com/excalidraw/excalidraw",
  },
  excalidraw: {
    name: "@excalidraw/excalidraw",
    version: DRAW,
    dependencies: {
      "@excalidraw/common": DRAW,
      "@excalidraw/element": DRAW,
      "@excalidraw/laser-pointer": "1.3.1",
      "@excalidraw/math": DRAW,
      nanoid: "3.3.3",
    },
    peerDependencies: { react: "^19.0.0" },
    publishConfig: { access: "public" },
    repository: "https://github.com/excalidraw/excalidraw",
  },
};

describe("siblingClosure", () => {
  // Defect: recursing through common -> math -> common without a visited set
  // never terminates, and listing the package itself bundles it into itself.
  it("walks the common <-> math cycle once and leaves the package out", () => {
    expect(siblingClosure("common", packed)).toEqual(["math"]);
    expect(siblingClosure("math", packed)).toEqual(["common"]);
  });

  // Defect: a closure of declared dependencies only misses fractional-indexing,
  // which excalidraw imports and reaches only through element.
  it("reaches siblings that are only transitive dependencies", () => {
    expect(siblingClosure("excalidraw", packed)).toEqual([
      "common",
      "fractional-indexing",
      "math",
      "element",
    ]);
    expect(siblingClosure("fractional-indexing", packed)).toEqual([]);
  });
});

describe("registryManifest", () => {
  const manifest = (id: string) =>
    registryManifest(packed, id, "1.0.0", SHA, siblingClosure(id, packed));

  // Defect: aliasing only declared siblings leaves excalidraw's built import
  // of @excalidraw/fractional-indexing unresolvable under pnpm hoist=false.
  it("aliases every sibling in the closure, declared or not", () => {
    expect(manifest("excalidraw").dependencies).toEqual({
      "@excalidraw/laser-pointer": "1.3.1",
      nanoid: "3.3.3",
      "@excalidraw/common": "npm:@redaphid/excalidraw-common@1.0.0",
      "@excalidraw/fractional-indexing":
        "npm:@redaphid/excalidraw-fractional-indexing@1.0.0",
      "@excalidraw/math": "npm:@redaphid/excalidraw-math@1.0.0",
      "@excalidraw/element": "npm:@redaphid/excalidraw-element@1.0.0",
    });
  });

  // Defect: a manifest still named @excalidraw/*, at draw.N, or with an
  // npmjs publishConfig would publish to the wrong place or the wrong version,
  // and without gitHead nothing ties the package back to its commit.
  it("stamps the registry identity, version, commit and target", () => {
    expect(manifest("element")).toMatchObject({
      name: "@redaphid/excalidraw-element",
      version: "1.0.0",
      gitHead: SHA,
      publishConfig: { registry: GITHUB_REGISTRY },
      repository: {
        type: "git",
        url: "git+https://github.com/redaphid/excalidraw.git",
        directory: "packages/element",
      },
    });
    expect(manifest("excalidraw").name).toBe("@redaphid/excalidraw");
    expect(manifest("excalidraw").publishConfig).toEqual({
      registry: "https://npm.pkg.github.com",
    });
  });

  // Defect: a bundled sibling installs a second copy beside the aliased one,
  // so the registry flavor must resolve every sibling through the registry.
  it("drops bundleDependencies", () => {
    const bundled = {
      ...packed,
      element: {
        ...packed.element,
        bundleDependencies: ["@excalidraw/common"],
      },
    };
    const element = registryManifest(
      bundled,
      "element",
      "1.0.0",
      SHA,
      siblingClosure("element", bundled),
    );
    expect(element).not.toHaveProperty("bundleDependencies");
  });
});

describe("urlManifest", () => {
  // Defect: a tarball that does not bundle its siblings, or pins them at the
  // draw version, sends the draw app's URL install to a registry that has
  // neither.
  it("bundles the sibling closure at the release version", () => {
    expect(
      urlManifest(
        packed,
        "element",
        "1.0.0",
        siblingClosure("element", packed),
      ),
    ).toEqual({
      name: "@excalidraw/element",
      version: "1.0.0",
      dependencies: {
        "@excalidraw/common": "1.0.0",
        "@excalidraw/math": "1.0.0",
        "@excalidraw/fractional-indexing": "1.0.0",
        tinycolor2: "1.6.0",
      },
      bundleDependencies: [
        "@excalidraw/common",
        "@excalidraw/fractional-indexing",
        "@excalidraw/math",
      ],
      publishConfig: { access: "public" },
      repository: "https://github.com/excalidraw/excalidraw",
    });
  });

  // Defect: a tarball whose manifest keeps draw.N while its file name says
  // 1.0.0 installs as the wrong version.
  it("stamps a package with no siblings without bundling anything", () => {
    expect(urlManifest(packed, "fractional-indexing", "1.0.0", [])).toEqual({
      ...packed["fractional-indexing"],
      version: "1.0.0",
    });
  });
});

describe("declarationTarget", () => {
  const elementDeclares = [
    "@excalidraw/common",
    "@excalidraw/math",
    "@excalidraw/fractional-indexing",
  ];

  it.each([
    ["@excalidraw/element", "element/src/index"],
    ["@excalidraw/element/types", "element/src/types"],
    ["@excalidraw/excalidraw/types", "excalidraw/types"],
    ["@excalidraw/utils/shape", "utils/src/shape"],
  ])("points element's %s at its own copy, %s", (specifier, target) => {
    // Defect: a self import or an undeclared package stays bare, and a strict
    // install turns its types into any.
    expect(declarationTarget(specifier, "element", elementDeclares)).toBe(
      target,
    );
  });

  it.each([
    "@excalidraw/common",
    "@excalidraw/common/utility-types",
    "@excalidraw/math",
    "react",
  ])("leaves element's %s to resolve through its dependencies", (specifier) => {
    // Defect: a declared sibling's types are copied, so two copies of one
    // type no longer match.
    expect(declarationTarget(specifier, "element", elementDeclares)).toBe(null);
  });

  it("points excalidraw's own name at its root", () => {
    expect(declarationTarget("@excalidraw/excalidraw", "excalidraw", [])).toBe(
      "excalidraw/index",
    );
  });
});
