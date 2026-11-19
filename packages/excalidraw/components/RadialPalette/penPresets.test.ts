import fs from "node:fs";
import path from "node:path";

import {
  FREEDRAW_STROKE_WIDTH,
  FREEDRAW_STROKE_WIDTH_RANGE,
} from "@excalidraw/common";

import { EMPTY_CSS_THEME, readCssTheme } from "../../cssTheme";

import { getActivePenPreset, getPenPresets } from "./penPresets";

import type { PenPreset } from "./penPresets";

const parchment = readCssTheme({
  getPropertyValue: (name: string) =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(
      fs.readFileSync(
        path.resolve(__dirname, "../../themes/architect-parchment.css"),
        "utf8",
      ),
    )?.[1] ?? "",
});

const byId = (presets: readonly PenPreset[], id: PenPreset["id"]) =>
  presets.find((preset) => preset.id === id)!.state;

describe("penPresets", () => {
  describe("with the parchment theme", () => {
    let presets: readonly PenPreset[];

    beforeEach(() => {
      presets = getPenPresets(parchment);
    });

    it("makes the fine liner the theme's own pen", () => {
      expect(byId(presets, "liner")).toEqual({
        currentItemStrokeVariability: "variable",
        currentItemFreedrawStrokeWidth: 0.2,
        currentItemOpacity: 100,
        currentItemPenOptions: null,
      });
    });

    it("scales every other pen from the theme's width", () => {
      expect(
        presets.map((preset) => preset.state.currentItemFreedrawStrokeWidth),
      ).toEqual([
        0.2,
        0.2 * 1.5,
        0.2 * 5,
        0.2 * 8,
        FREEDRAW_STROKE_WIDTH_RANGE.max,
      ]);
    });

    it("gives the pencil a light, wobbly line", () => {
      expect(byId(presets, "pencil")).toMatchObject({
        currentItemStrokeVariability: "variable",
        currentItemOpacity: 70,
        currentItemPenOptions: { thinning: 0.35, taper: 2, streamline: 0.15 },
      });
    });

    it("gives the brush strong pressure and long tapers", () => {
      expect(byId(presets, "brush")).toMatchObject({
        currentItemStrokeVariability: "variable",
        currentItemOpacity: 100,
        currentItemPenOptions: { thinning: 0.8, taper: 10, streamline: 0.5 },
      });
    });

    it("gives the marker an even, slightly see-through line", () => {
      expect(byId(presets, "marker")).toMatchObject({
        currentItemStrokeVariability: "constant",
        currentItemOpacity: 85,
      });
    });

    it("gives the wash a broad, faint line", () => {
      expect(byId(presets, "wash")).toMatchObject({
        currentItemStrokeVariability: "constant",
        currentItemOpacity: 25,
      });
    });

    describe("when the pen matches a preset", () => {
      it("finds that preset", () => {
        expect(getActivePenPreset(presets, byId(presets, "marker"))?.id).toBe(
          "marker",
        );
      });
    });

    describe("when the pen was resized after a preset", () => {
      it("finds none", () => {
        expect(
          getActivePenPreset(presets, {
            ...byId(presets, "marker"),
            currentItemFreedrawStrokeWidth: 0.7,
          }),
        ).toBeNull();
      });
    });
  });

  describe("with no theme", () => {
    it("starts the fine liner at Excalidraw's thin, even pen", () => {
      expect(byId(getPenPresets(EMPTY_CSS_THEME), "liner")).toMatchObject({
        currentItemStrokeVariability: "constant",
        currentItemFreedrawStrokeWidth: FREEDRAW_STROKE_WIDTH.thin,
      });
    });
  });
});
