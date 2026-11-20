#!/usr/bin/env node
// Rewrites tests that pick a tool by clicking its toolbar button to UI.clickTool,
// which sets the tool through the app (#241). Idempotent.
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  // const tool = getByToolName("x"); ... fireEvent.click(tool);
  src = src.replace(
    /const (\w+) = (?:[\w.]+\.)?getByToolName\(("[\w-]+"|'[\w-]+')\);(\s*(?:\/\/[^\n]*\s*)*)fireEvent\.click\(\1\);/g,
    (_m, _v, name, gap) => `UI.clickTool(${name});`,
  );
  // fireEvent.click(getByToolName("x"))
  src = src.replace(
    /fireEvent\.click\((?:[\w.]+\.)?getByToolName\(("[\w-]+"|'[\w-]+')\)\)/g,
    (_m, name) => `UI.clickTool(${name})`,
  );
  // drop getByToolName from destructuring when nothing uses it any more
  if (!/getByToolName\(/.test(src)) {
    src = src.replace(/\{\s*getByToolName,\s*/g, "{ ");
    src = src.replace(/,\s*getByToolName(\s*)\}/g, "$1}");
  }
  if (src.includes("UI.clickTool") && !/\bUI\b[^\n]*from "\.\/helpers\/ui"/.test(src) && !/import[^;]*\bUI\b[^;]*helpers\/ui/s.test(src)) {
    src = src.replace(/^(import[^;]+;\n)(?![\s\S]*^import)/m, '$1import { UI } from "./helpers/ui";\n');
  }
  if (src !== before) {
    writeFileSync(file, src);
    console.log("rewrote", file);
  }
}
