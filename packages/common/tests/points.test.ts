import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { getSizeFromPoints } from "../src/points";

// a stroke that kept going: one point per pointermove at 120 Hz for twenty
// minutes, more than a spread call can pass as arguments
const longStroke = (count: number) => {
  const points: LocalPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push(
      pointFrom<LocalPoint>(Math.sin(i / 300) * 900 + i / 50, (i % 977) - 400),
    );
  }
  return points;
};

describe("getSizeFromPoints", () => {
  it("measures a stroke too long to spread into Math.max", () => {
    const points = longStroke(150_000);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const fold = (values: number[], pick: typeof Math.max) =>
      values.reduce((a, b) => pick(a, b));

    expect(getSizeFromPoints(points)).toEqual({
      width: fold(xs, Math.max) - fold(xs, Math.min),
      height: fold(ys, Math.max) - fold(ys, Math.min),
    });
  });

  it("keeps the edge cases of Math.max and Math.min", () => {
    expect(getSizeFromPoints([])).toEqual({
      width: -Infinity,
      height: -Infinity,
    });
    expect(getSizeFromPoints([pointFrom<LocalPoint>(3, -4)])).toEqual({
      width: 0,
      height: 0,
    });
    expect(
      getSizeFromPoints([
        pointFrom<LocalPoint>(-0, 0),
        pointFrom<LocalPoint>(0, -0),
      ]),
    ).toEqual({ width: 0, height: 0 });
    expect(
      getSizeFromPoints([
        pointFrom<LocalPoint>(1, NaN),
        pointFrom<LocalPoint>(5, 2),
      ]),
    ).toEqual({ width: 4, height: NaN });
  });
});
