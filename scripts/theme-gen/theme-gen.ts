/**
 * Writes playground/themes/<id>.css from playground/themes/tokens/<id>.json
 * with generateThemeCss from @excalidraw/common, and prints its warnings.
 *
 *   yarn theme:gen architect-parchment [more ids...]
 *   yarn theme:gen --all
 *   yarn theme:gen --schema     writes playground/themes/tokens/schema.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { THEME_TOKENS_SCHEMA, generateThemeCss } from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

const tokensDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../playground/themes/tokens",
);

const args = process.argv.slice(2).filter((arg) => arg !== "--");

if (args.includes("--schema")) {
  fs.writeFileSync(
    path.join(tokensDir, "schema.json"),
    `${JSON.stringify(THEME_TOKENS_SCHEMA, null, 2)}\n`,
  );
  process.stdout.write("playground/themes/tokens/schema.json\n");
}

const ids = args.includes("--all")
  ? fs
      .readdirSync(tokensDir)
      .filter((file) => file.endsWith(".json") && file !== "schema.json")
      .map((file) => file.replace(/\.json$/, ""))
  : args.filter((arg) => !arg.startsWith("--"));

for (const id of ids) {
  const tokens: ThemeTokens = JSON.parse(
    fs.readFileSync(path.join(tokensDir, `${id}.json`), "utf8"),
  );
  const { css, warnings } = generateThemeCss(tokens);
  fs.writeFileSync(path.join(tokensDir, "..", `${id}.css`), css);
  process.stdout.write(`playground/themes/${id}.css\n`);
  for (const { token, from, to, reason } of warnings) {
    process.stdout.write(`  ${token}: ${from} -> ${to} (${reason})\n`);
  }
}
