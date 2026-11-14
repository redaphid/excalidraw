import fs from "fs";
import path from "path";
import { brotliDecompressSync } from "zlib";

import { FONT_FAMILY, FONT_METADATA } from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";

import type { FontAxes } from "@excalidraw/common";
import type { FontFamilyValues } from "@excalidraw/element/types";

import { Fonts } from "./Fonts";

const SHANTELL = FONT_FAMILY["Shantell Sans"];

/** The tags WOFF2 names by number, as far as `fvar` (47). */
const KNOWN_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
];

/** A table of a woff2 file, as the font itself holds it. */
const woff2Table = (file: string, wanted: string): Buffer => {
  const bytes = fs.readFileSync(file);
  const tableCount = bytes.readUInt16BE(12);
  const compressedLength = bytes.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (;;) {
      const byte = bytes[at++];
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) {
        return value;
      }
    }
  };
  const tables: { tag: string; length: number }[] = [];
  for (let i = 0; i < tableCount; i++) {
    const flags = bytes[at++];
    const known = flags & 63;
    const tag =
      known === 63
        ? bytes.toString("latin1", at, (at += 4))
        : KNOWN_TAGS[known] ?? `#${known}`;
    const version = flags >> 6;
    const length = base128();
    const transformed =
      tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(bytes.subarray(at, at + compressedLength));
  let offset = 0;
  for (const { tag, length } of tables) {
    if (tag === wanted) {
      return data.subarray(offset, offset + length);
    }
    offset += length;
  }
  throw new Error(`${file} has no ${wanted} table`);
};

/** The axes of a variable font's `fvar` table, by tag. */
const fvarAxes = (fvar: Buffer) => {
  const fixed = (at: number) => fvar.readInt32BE(at) / 65536;
  const start = fvar.readUInt16BE(4);
  const count = fvar.readUInt16BE(8);
  const size = fvar.readUInt16BE(10);
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const at = start + i * size;
      return [
        fvar.toString("latin1", at, at + 4),
        { min: fixed(at + 4), max: fixed(at + 12) },
      ];
    }),
  );
};

describe("Fonts", () => {
  describe("a variable family", () => {
    const fontFile = path.join(
      __dirname,
      "ShantellSans",
      fs
        .readdirSync(path.join(__dirname, "ShantellSans"))
        .find((name) => name.endsWith(".woff2"))!,
    );

    it("is registered with a face", () => {
      expect(Fonts.registered.get(SHANTELL)?.fontFaces).toHaveLength(1);
    });

    it("is registered with the axes of its metadata", () => {
      expect(Fonts.registered.get(SHANTELL)?.metadata.axes).toBe(
        FONT_METADATA[SHANTELL].axes,
      );
    });

    it("has in its metadata the axes and ranges of the font file", () => {
      const registered = Object.fromEntries(
        Object.entries(FONT_METADATA[SHANTELL].axes!).map(
          ([tag, { min, max }]) => [tag, { min, max }],
        ),
      );
      expect(registered).toEqual(fvarAxes(woff2Table(fontFile, "fvar")));
    });

    it("has in its metadata the metrics of the font file", () => {
      const head = woff2Table(fontFile, "head");
      const hhea = woff2Table(fontFile, "hhea");
      expect(FONT_METADATA[SHANTELL].metrics).toMatchObject({
        unitsPerEm: head.readUInt16BE(18),
        ascender: hhea.readInt16BE(4),
        descender: hhea.readInt16BE(6),
      });
    });

    it("ships its license beside the font file", () => {
      expect(
        fs.readFileSync(path.join(path.dirname(fontFile), "OFL.txt"), "utf8"),
      ).toContain("SIL OPEN FONT LICENSE Version 1.1");
    });
  });

  describe("getInstances", () => {
    const text = (
      text: string,
      fontFamily: FontFamilyValues,
      fontAxes?: FontAxes,
    ) => newTextElement({ x: 0, y: 0, text, fontFamily, fontAxes });

    it("finds one instance for each distinct set of axes off the regular one", () => {
      const instances = Fonts.getInstances([
        text("merged", SHANTELL, { wght: 800 }),
        text("flaky", SHANTELL, { wght: 300, BNCE: 100 }),
        text("failing", SHANTELL, { wght: 800 }),
        text("plain", SHANTELL),
        text("regular", SHANTELL, { wght: 400 }),
        text("other", FONT_FAMILY.Nunito, { wght: 800 }),
      ]);
      expect(Array.from(instances.keys())).toEqual([
        "Shantell Sans wght800",
        "Shantell Sans wght300 BNCE100",
      ]);
    });

    it("gathers the characters drawn in an instance", () => {
      const instances = Fonts.getInstances([
        text("ab", SHANTELL, { wght: 800 }),
        text("bc", SHANTELL, { wght: 800 }),
      ]);
      expect(
        Array.from(instances.get("Shantell Sans wght800")!.chars).join(""),
      ).toBe("abc");
    });

    it("carries the variation settings of the instance's faces", () => {
      const instances = Fonts.getInstances([
        text("flaky", SHANTELL, { wght: 300, BNCE: 100 }),
      ]);
      expect(
        instances.get("Shantell Sans wght300 BNCE100")!.variationSettings,
      ).toBe('"wght" 300, "INFM" 0, "BNCE" 100, "SPAC" 0');
    });
  });
});
