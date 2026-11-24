import { applyDarkModeFilter, DEFAULT_FILL_GRADIENT } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { getFillGradient } from "../src/fillGradient";
import { newElement, newLinearElement } from "../src/newElement";

import type { FillGradient } from "../src/types";

const rectangle = (
  props: {
    fillStyle?: "solid" | "gradient";
    backgroundColor?: string;
    fillGradient?: FillGradient;
  } = {},
) =>
  newElement({
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    backgroundColor: "#ff0000",
    fillStyle: "gradient",
    ...props,
  });

const rounded = (gradient: ReturnType<typeof getFillGradient>) =>
  gradient &&
  Object.fromEntries(
    Object.entries(gradient).map(([key, value]) => [
      key,
      typeof value === "number" ? Math.round(value * 1e6) / 1e6 + 0 : value,
    ]),
  );

describe("getFillGradient", () => {
  it("is null for an element without a gradient fill", () => {
    expect(
      getFillGradient(rectangle({ fillStyle: "solid" }), false),
    ).toBeNull();
  });

  it("is null for a transparent background", () => {
    expect(
      getFillGradient(rectangle({ backgroundColor: "transparent" }), false),
    ).toBeNull();
  });

  it("runs a 90° linear gradient left to right across the element", () => {
    expect(
      rounded(
        getFillGradient(
          rectangle({
            fillGradient: { type: "linear", color: "#0000ff", angle: 90 },
          }),
          false,
        ),
      ),
    ).toEqual({
      type: "linear",
      x1: 0,
      y1: 25,
      x2: 100,
      y2: 25,
      colors: ["#ff0000", "#0000ff"],
    });
  });

  it("runs a 0° linear gradient bottom to top", () => {
    const gradient = getFillGradient(
      rectangle({
        fillGradient: { type: "linear", color: "#0000ff", angle: 0 },
      }),
      false,
    );

    expect(rounded(gradient)).toEqual({
      type: "linear",
      x1: 50,
      y1: 50,
      x2: 50,
      y2: 0,
      colors: ["#ff0000", "#0000ff"],
    });
  });

  it("reaches the corners with a diagonal linear gradient", () => {
    const gradient = getFillGradient(
      newElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        backgroundColor: "#ff0000",
        fillStyle: "gradient",
        fillGradient: { type: "linear", color: "#0000ff", angle: 135 },
      }),
      false,
    );

    expect(rounded(gradient)).toEqual({
      type: "linear",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      colors: ["#ff0000", "#0000ff"],
    });
  });

  it("centers a radial gradient that reaches the corners", () => {
    expect(
      getFillGradient(
        newElement({
          type: "ellipse",
          x: 0,
          y: 0,
          width: 80,
          height: 60,
          backgroundColor: "#ff0000",
          fillStyle: "gradient",
          fillGradient: { type: "radial", color: "#0000ff", angle: 0 },
        }),
        false,
      ),
    ).toEqual({
      type: "radial",
      cx: 40,
      cy: 30,
      r: 50,
      colors: ["#ff0000", "#0000ff"],
    });
  });

  it("uses the default gradient when the element has none", () => {
    expect(getFillGradient(rectangle(), false)).toEqual(
      getFillGradient(
        rectangle({ fillGradient: DEFAULT_FILL_GRADIENT }),
        false,
      ),
    );
  });

  it("filters both colors in dark mode", () => {
    expect(
      getFillGradient(
        rectangle({
          fillGradient: { type: "linear", color: "#0000ff", angle: 90 },
        }),
        true,
      )?.colors,
    ).toEqual([
      applyDarkModeFilter("#ff0000", true),
      applyDarkModeFilter("#0000ff", true),
    ]);
  });

  it("spans the bounding box of a closed line's points", () => {
    const line = newLinearElement({
      type: "line",
      x: 500,
      y: 500,
      backgroundColor: "#ff0000",
      fillStyle: "gradient",
      fillGradient: { type: "linear", color: "#0000ff", angle: 90 },
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(40, -30),
        pointFrom<LocalPoint>(-20, 10),
        pointFrom<LocalPoint>(0, 0),
      ],
    });

    expect(rounded(getFillGradient(line, false))).toMatchObject({
      x1: -20,
      y1: -10,
      x2: 40,
      y2: -10,
    });
  });
});
