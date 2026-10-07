import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { THEME_TOKENS_SCHEMA, generateThemeCss } from "@excalidraw/common";

import catalog from "../themes/index.json";

const THEMES_DIR = path.resolve(__dirname, "../themes");

const read = (file: string) =>
  fs.readFileSync(path.join(THEMES_DIR, file), "utf8").replace(/\r\n/g, "\n");

const filesEndingWith = (suffix: string) =>
  fs
    .readdirSync(THEMES_DIR)
    .filter((file) => file.endsWith(suffix))
    .map((file) => file.slice(0, -suffix.length))
    .sort();

const names = catalog.themes.map(({ name }) => name).sort();

describe("the sample themes index", () => {
  it("lists every stylesheet in themes/", () => {
    expect(names).toEqual(filesEndingWith(".css"));
  });

  it("marks exactly the themes with a tokens file as generated", () => {
    expect(
      catalog.themes
        .filter(({ generated }) => generated)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(filesEndingWith(".tokens.json"));
  });

  it.each(catalog.themes)(
    "names $name and its mode as its stylesheet does",
    ({ name, title, mode }) => {
      expect(read(`${name}.css`)).toMatch(
        new RegExp(`^/\\* ${title}\\. mode: ${mode} \\*/`),
      );
    },
  );

  it.each(catalog.themes.filter(({ generated }) => generated))(
    "has $name's stylesheet generated from its tokens",
    ({ name }) => {
      expect(read(`${name}.css`)).toBe(
        generateThemeCss(JSON.parse(read(`${name}.tokens.json`))).css,
      );
    },
  );

  it.each(catalog.themes.filter(({ mode }) => mode === "dark"))(
    "warns about $name's dark canvas",
    ({ caveats }) => {
      expect(caveats.join(" ")).toMatch(/theme="dark"/);
    },
  );

  it.each(catalog.themes)(
    "describes $name in one or two sentences",
    ({ description }) => {
      expect(description.match(/[.!?](\s|$)/g)?.length).toBeLessThanOrEqual(2);
    },
  );

  it.each(catalog.themes.filter(({ generated }) => generated))(
    "has $name's tokens valid against the schema",
    ({ name }) => {
      const validate = new Ajv2020().compile(THEME_TOKENS_SCHEMA);
      expect(
        validate(JSON.parse(read(`${name}.tokens.json`)))
          ? []
          : validate.errors,
      ).toEqual([]);
    },
  );

  it.each(catalog.themes.filter(({ generated }) => generated))(
    "reads $name's tokens without a complaint about the document",
    ({ name }) => {
      expect(
        generateThemeCss(
          JSON.parse(read(`${name}.tokens.json`)),
        ).warnings.filter(({ reason }) =>
          /not a |names no token|no \$type|not supported|alpha|read as|using Excalidraw/.test(
            reason,
          ),
        ),
      ).toEqual([]);
    },
  );

  it("ships the generator's schema", () => {
    expect(JSON.parse(read("tokens.schema.json"))).toEqual(
      JSON.parse(JSON.stringify(THEME_TOKENS_SCHEMA)),
    );
  });
});
