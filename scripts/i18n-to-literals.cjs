#!/usr/bin/env node
// Turns every `t("key")` and `t("key", { name: value })` whose key is a string
// literal into the English string from packages/excalidraw/locales/en.json, as a
// string literal or a template literal. Draw is English only, so the lookup is
// dead weight. A call whose key is computed is left alone and listed, for a hand
// to finish.
//
//   node scripts/i18n-to-literals.cjs [--dry] [files or dirs...]
//
// Rerunnable: a second run finds nothing left to change. With no paths it walks
// packages/ and excalidraw-app/, tests included.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const EN = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "packages/excalidraw/locales/en.json"),
    "utf8",
  ),
);
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const roots = args.filter((a) => a !== "--dry");

const lookup = (key) => {
  let node = EN;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object" || !(part in node)) {
      return undefined;
    }
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
};

const walk = (p, out) => {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    if (/node_modules|dist|build|locales/.test(path.basename(p))) {
      return out;
    }
    for (const name of fs.readdirSync(p)) {
      walk(path.join(p, name), out);
    }
  } else if (/\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts")) {
    out.push(p);
  }
  return out;
};

/** the calls' callee: `t` imported from i18n, or destructured from useI18n() */
const isT = (expr) => ts.isIdentifier(expr) && expr.text === "t";

/** a JS string literal, in the file's double quotes */
const quote = (s) => JSON.stringify(s);

/** a template literal body, escaped */
const tpl = (s) =>
  s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

let pass = 0;
const run = () => {
  const files = (roots.length ? roots : ["packages", "excalidraw-app"])
    .map((r) => path.resolve(ROOT, r))
    .flatMap((r) => walk(r, []));

  const left = [];
  let changed = 0;
  let calls = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\bt\(/.test(text)) {
      continue;
    }
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const edits = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && isT(node.expression)) {
        const [key, replacement] = node.arguments;
        const where = `${path.relative(ROOT, file)}:${
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1
        }`;
        // the replacements, as name -> source text, or null when they are not a plain object literal
        const values =
          !replacement || replacement.kind === ts.SyntaxKind.NullKeyword
            ? new Map()
            : ts.isObjectLiteralExpression(replacement) &&
              replacement.properties.every(
                (p) =>
                  (ts.isPropertyAssignment(p) &&
                    (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) ||
                  ts.isShorthandPropertyAssignment(p),
              )
            ? new Map(
                replacement.properties.map((p) => [
                  p.name.text,
                  ts.isShorthandPropertyAssignment(p)
                    ? p.name.text
                    : p.initializer.getText(),
                ]),
              )
            : null;
        // English for a key: a literal key, or conditionals whose every leaf is one
        const english = (e) => {
          while (e && ts.isParenthesizedExpression(e)) {
            e = e.expression;
          }
          if (!e) {
            return undefined;
          }
          if (ts.isConditionalExpression(e)) {
            const a = english(e.whenTrue);
            const b = english(e.whenFalse);
            return a === undefined || b === undefined
              ? undefined
              : `(${e.condition.getText()} ? ${a} : ${b})`;
          }
          const text =
            ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)
              ? lookup(e.text)
              : undefined;
          if (text === undefined) {
            return undefined;
          }
          if (!values.size) {
            return quote(text);
          }
          // `t` replaces each {{name}} once, the first occurrence, as String(value)
          let body = tpl(text);
          for (const [name, value] of values) {
            body = body.replace(`{{${name}}}`, `\${${value}}`);
          }
          return `\`${body}\``;
        };
        const literal = values && english(key);
        if (literal === undefined || literal === null) {
          left.push(`${where}  ${node.getText().slice(0, 90)}`);
        } else {
          edits.push([node.getStart(), node.getEnd(), literal]);
          // a t() inside the replacements was copied as text: the next pass gets it
          calls++;
          return;
        }
        calls++;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!edits.length) {
      continue;
    }
    let out = text;
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
      out = out.slice(0, start) + replacement + out.slice(end);
    }
    // a component that no longer calls t needs no useI18n(); unused imports go
    // with TypeScript's organizeImports afterwards
    if (!/\bt\(/.test(out)) {
      out = out.replace(/^[ \t]*const \{ t \} = useI18n\(\);\n/gm, "");
    }
    changed += edits.length;
    if (!dry) {
      fs.writeFileSync(file, out);
    }
  }
  return { changed, calls, left };
};
// nested calls come out one level per pass, so run to a fixed point
let total = 0;
let last;
do {
  last = run();
  total += last.changed;
  pass++;
} while (!dry && last.changed && pass < 10);
console.log(
  `${
    dry ? "would replace" : "replaced"
  } ${total} t() calls in ${pass} pass(es); ${
    last.left.length
  } left for a hand:`,
);
for (const line of last.left) {
  console.log(`  ${line}`);
}
