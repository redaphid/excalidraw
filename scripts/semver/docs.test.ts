import fs from "fs";
import path from "path";

import { consumerNpmrc, GITHUB_REGISTRY } from "./packages";

const dedented = (file: string) =>
  fs
    .readFileSync(path.resolve(__dirname, "../..", file), "utf8")
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n");

describe("consumer docs", () => {
  // The verify step installs with consumerNpmrc's output, so a doc that
  // drifts from it tells consumers a setup no check has run.
  it.each(["README.md", "docs/releasing.md"])(
    "%s shows the .npmrc the consumer checks install with",
    (file) => {
      expect(dedented(file)).toContain(consumerNpmrc(GITHUB_REGISTRY));
    },
  );
});
