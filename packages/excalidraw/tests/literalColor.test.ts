import { applyDarkModeFilter, THEME } from "@excalidraw/common";
import { ShapeCache } from "@excalidraw/element";
import { exportToCanvas } from "@excalidraw/utils";

import type {
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import * as exportUtils from "../scene/export";

import { API } from "./helpers/api";

import type { Options } from "roughjs/bin/core";

// A palette chip drawn with the exact hexes a theme names: a dark board
// must show them as stored, or the label beside the chip lies.
const STROKE = "#0b0c0e";
const FILL = "#ebe4d6";

const literally = (literal: boolean) =>
  literal ? { literalColor: true } : undefined;

const chip = (literal: boolean) =>
  ({
    ...API.createElement({
      type: "rectangle",
      strokeColor: STROKE,
      backgroundColor: FILL,
      fillStyle: "solid",
    }),
    customData: literally(literal),
  } as NonDeleted<ExcalidrawRectangleElement>);

const label = (literal: boolean) =>
  ({
    ...API.createElement({
      type: "text",
      text: "#0b0c0e",
      strokeColor: STROKE,
    }),
    customData: literally(literal),
  } as NonDeleted<ExcalidrawTextElement>);

const darkOptions = (element: ExcalidrawRectangleElement) =>
  (
    ShapeCache.generateElementShape(element, {
      isExporting: true,
      canvasBackgroundColor: "#000000",
      embedsValidationStatus: new Map(),
      theme: THEME.DARK,
    }) as unknown as { options: Options }
  ).options;

const darkSvg = (elements: NonDeleted<ExcalidrawTextElement>[]) =>
  exportUtils.exportToSvg(
    elements,
    {
      exportBackground: false,
      viewBackgroundColor: "#ffffff",
      exportWithDarkMode: true,
    },
    null,
  );

const fillStylesOnDarkCanvas = async (
  elements: NonDeleted<ExcalidrawTextElement>[],
) => {
  const canvas = await exportToCanvas({
    elements,
    files: null,
    appState: {
      exportBackground: false,
      viewBackgroundColor: "#ffffff",
      exportWithDarkMode: true,
    },
  });
  const context = canvas.getContext("2d") as unknown as {
    __getEvents: () => { type: string; props: { value: string } }[];
  };
  return context
    .__getEvents()
    .filter((event) => event.type === "fillStyle")
    .map((event) => event.props.value);
};

describe("an element whose customData asks for literal colour", () => {
  describe("when its shape is drawn on a dark board", () => {
    it("strokes with the stored colour", () => {
      expect(darkOptions(chip(true)).stroke).toBe(STROKE);
    });

    it("fills with the stored colour", () => {
      expect(darkOptions(chip(true)).fill).toBe(FILL);
    });
  });

  describe("when its text is exported to a dark SVG", () => {
    it("fills with the stored colour", async () => {
      const svg = await darkSvg([label(true)]);
      expect(svg.querySelector("text")?.getAttribute("fill")).toBe(STROKE);
    });
  });

  describe("when its text is drawn on a dark canvas", () => {
    it("fills with the stored colour", async () => {
      expect(await fillStylesOnDarkCanvas([label(true)])).toContain(STROKE);
    });
  });
});

describe("an element without the flag", () => {
  describe("when its shape is drawn on a dark board", () => {
    it("strokes with the dark-mode colour", () => {
      expect(darkOptions(chip(false)).stroke).toBe(applyDarkModeFilter(STROKE));
    });
  });

  describe("when its text is drawn on a dark canvas", () => {
    it("fills with the dark-mode colour", async () => {
      expect(await fillStylesOnDarkCanvas([label(false)])).not.toContain(
        STROKE,
      );
    });
  });
});
