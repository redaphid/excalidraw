import { RoughGenerator } from "roughjs/bin/generator";

import { THEME, arrayToMap } from "@excalidraw/common";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  ExcalidrawRoughGenerator,
  ShapeCache,
  generateLinearCollisionShape,
} from "../src";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  Theme,
} from "../src/types";
import type { Options } from "roughjs/bin/core";

const STYLES = (["solid", "dashed", "dotted"] as const).flatMap((strokeStyle) =>
  [0, 1, 2].flatMap((roughness) =>
    [1, 4].map((strokeWidth) => ({ strokeStyle, roughness, strokeWidth })),
  ),
);

const elbowArrow = (style: typeof STYLES[number]) =>
  API.createElement({
    type: "arrow",
    elbowed: true,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(120, 0),
      pointFrom<LocalPoint>(120, 90),
    ],
    ...style,
  }) as ExcalidrawLinearElement;

/** every element drawn from an SVG path: rounded rectangles and diamonds,
 * and elbow arrows */
const pathShapes = (backgroundColor: string) =>
  STYLES.flatMap((style) => [
    ...(["rectangle", "diamond"] as const).map((type) =>
      API.createElement({
        type,
        width: 180,
        height: 70,
        roundness: { type: 3 },
        backgroundColor,
        ...style,
      }),
    ),
    elbowArrow(style),
  ]);

const generate = (element: ExcalidrawElement, theme: Theme) => {
  ShapeCache.delete(element);
  ShapeCache.generateElementShape(
    element as Parameters<typeof ShapeCache.generateElementShape>[0],
    {
      isExporting: false,
      canvasBackgroundColor: "#ffffff",
      embedsValidationStatus: new Map(),
      theme,
    },
  );
};

/** the paths and options Excalidraw asks rough.js for during `run` */
const pathsAskedFor = (run: () => void) => {
  const asked = vi.spyOn(ExcalidrawRoughGenerator.prototype, "path");
  run();
  const calls = asked.mock.calls as [string, Options][];
  asked.mockRestore();
  return calls;
};

const drawnAsRoughDrawsIt = ([d, options]: [string, Options]) =>
  expect(new ExcalidrawRoughGenerator().path(d, options)).toEqual(
    new RoughGenerator().path(d, options),
  );

describe("a path with no fill", () => {
  it.each([THEME.LIGHT, THEME.DARK])(
    "is drawn as rough.js's path() draws it, in the %s theme",
    (theme) => {
      const paths = pathsAskedFor(() =>
        pathShapes("transparent").forEach((element) =>
          generate(element, theme),
        ),
      );
      expect(paths).toHaveLength(STYLES.length * 3);
      paths.forEach(drawnAsRoughDrawsIt);
    },
  );

  it("is drawn as rough.js's path() draws it for an elbow arrow's hit test", () => {
    const arrow = elbowArrow(STYLES[0]);
    const paths = pathsAskedFor(() =>
      generateLinearCollisionShape(arrow, arrayToMap([arrow])),
    );
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach(drawnAsRoughDrawsIt);
  });

  it("is drawn as rough.js's path() draws it without a stroke", () => {
    drawnAsRoughDrawsIt([
      "M 10 0 L 90 0 Q 100 0, 100 10 L 100 40 Q 100 50, 90 50 Z",
      { seed: 7, roughness: 1, stroke: "none" },
    ]);
  });

  it("is not flattened for a fill it does not have", () => {
    const flattening = vi.spyOn(RoughGenerator.prototype, "path");
    pathShapes("transparent").forEach((element) =>
      generate(element, THEME.LIGHT),
    );
    expect(flattening).not.toHaveBeenCalled();
  });
});

describe("a path with a fill", () => {
  it("is drawn by rough.js's own path()", () => {
    const flattening = vi.spyOn(RoughGenerator.prototype, "path");
    // elbow arrows are never filled
    const filled = pathShapes("#a5d8ff").filter(
      (element) => element.type !== "arrow",
    );
    filled.forEach((element) => generate(element, THEME.LIGHT));
    expect(flattening).toHaveBeenCalledTimes(filled.length);
  });
});
