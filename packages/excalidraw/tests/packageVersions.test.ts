import fs from "fs";
import path from "path";

const LOCKSTEP = [
  "common",
  "fractional-indexing",
  "math",
  "element",
  "excalidraw",
];

const read = (name: string) =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../../${name}/package.json`),
      "utf8",
    ),
  );

describe("package versions", () => {
  it("publishes the lockstep packages at one version, depending on each other at it", () => {
    const { version } = read("excalidraw");
    // semver: X.Y.Z, or a prerelease such as the hard fork's 2.0.0-hardfork.N
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    for (const name of LOCKSTEP) {
      const pkg = read(name);
      expect(pkg.version).toBe(version);
      for (const dependency of LOCKSTEP) {
        const range = pkg.dependencies?.[`@excalidraw/${dependency}`];
        if (range !== undefined) {
          expect(range).toBe(version);
        }
      }
    }
  });
});
