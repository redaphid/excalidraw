/**
 * Writes packages/excalidraw/themes/<id>.css from <id>.tokens.json beside it
 * with generateThemeCss from @excalidraw/common, and prints its warnings.
 * A new theme also needs an entry in themes/index.json.
 *
 *   yarn theme:gen architect-parchment [more ids...]
 *   yarn theme:gen --all
 *   yarn theme:gen --schema     writes themes/tokens.schema.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";

import { THEME_TOKENS_SCHEMA, generateThemeCss } from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

const THEMES = "packages/excalidraw/themes";
const TOKENS = ".tokens.json";

const themesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
  THEMES,
);

const args = process.argv.slice(2).filter((arg) => arg !== "--");

if (args.includes("--schema")) {
  const file = path.join(themesDir, "tokens.schema.json");
  fs.writeFileSync(
    file,
    prettier.format(JSON.stringify(THEME_TOKENS_SCHEMA), {
      ...prettier.resolveConfig.sync(file),
      parser: "json",
    }),
  );
  process.stdout.write(`${THEMES}/tokens.schema.json\n`);
}

const ids = args.includes("--all")
  ? fs
      .readdirSync(themesDir)
      .filter((file) => file.endsWith(TOKENS))
      .map((file) => file.slice(0, -TOKENS.length))
  : args.filter((arg) => !arg.startsWith("--"));

for (const id of ids) {
  const tokens: ThemeTokens = JSON.parse(
    fs.readFileSync(path.join(themesDir, `${id}${TOKENS}`), "utf8"),
  );
  const { css, warnings } = generateThemeCss(tokens);
  fs.writeFileSync(path.join(themesDir, `${id}.css`), css);
  process.stdout.write(`${THEMES}/${id}.css\n`);
  for (const { token, from, to, reason } of warnings) {
    process.stdout.write(`  ${token}: ${from} -> ${to} (${reason})\n`);
  }
}
