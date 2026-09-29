import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { getFreeDrawSvgPath } from "../renderer/renderElement";

import { API } from "./helpers/api";

import type { ExcalidrawFreeDrawElement } from "../element/types";

const DEEP_ZOOM = 100_000;

/**
 * An arch drawn at `zoom` with the thinnest pen scaled to it, `span` board
 * units wide and a third as tall.
 */
const arch = (span: number, zoom: number) =>
  API.createElement({
    type: "freedraw",
    strokeWidth: 1 / zoom,
    points: Array.from({ length: 21 }, (_, i) =>
      pointFrom<LocalPoint>(
        (i / 20) * span,
        Math.sin((i / 20) * Math.PI) * (span / 3),
      ),
    ),
  }) as ExcalidrawFreeDrawElement;

const pathCoordinates = (path: string) =>
  path.match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];

describe("a stroke a thousandth of a unit wide, drawn at 100,000x", () => {
  const path = () => getFreeDrawSvgPath(arch(0.001, DEEP_ZOOM));

  it("has a path", () => {
    expect(pathCoordinates(path()).length).toBeGreaterThan(8);
  });

  it("keeps its coordinates past two decimals", () => {
    const xs = pathCoordinates(path()).filter((_, i) => i % 2 === 0);
    expect(new Set(xs.map((x) => Math.round(x * 100))).size).toBeLessThan(
      new Set(xs).size,
    );
  });
});
