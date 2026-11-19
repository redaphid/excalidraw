import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { getBoundsFromPoints } from "../src/bounds";

describe("getBoundsFromPoints", () => {
  // A freedraw stroke's bounds are recomputed from every point on each move.
  // Reading a point's coordinates by index costs two reads; destructuring it
  // runs the array iterator on each point.
  it("reads only the x and y of each point", () => {
    let reads = 0;
    const points = Array.from(
      { length: 1000 },
      (_, i) =>
        new Proxy(pointFrom<LocalPoint>(Math.cos(i) * 50, i / 3), {
          get(target, key, receiver) {
            reads++;
            return Reflect.get(target, key, receiver);
          },
        }),
    );

    const bounds = getBoundsFromPoints(points, 2);

    expect(reads).toBe(2000);
    expect(bounds).toEqual([
      Math.min(...points.map(([x]) => x)) - 2,
      -2,
      Math.max(...points.map(([x]) => x)) + 2,
      999 / 3 + 2,
    ]);
  });

  it("keeps the edge cases of Math.min and Math.max", () => {
    expect(getBoundsFromPoints([])).toEqual([
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
    ]);
    const [minX, minY] = getBoundsFromPoints([
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(-0, -0),
    ]);
    expect(Object.is(minX, -0) && Object.is(minY, -0)).toBe(true);
    expect(
      getBoundsFromPoints([
        pointFrom<LocalPoint>(NaN, 1),
        pointFrom<LocalPoint>(3, 4),
      ]),
    ).toEqual([NaN, 1, NaN, 4]);
  });
});
