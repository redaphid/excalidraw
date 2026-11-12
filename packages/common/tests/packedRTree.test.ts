import {
  PACKED_RTREE_BUILD_CHUNK,
  PackedRTree,
  type PackedRTreeBuildWork,
} from "../src/packedRTree";

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomBoxes = (count: number) => {
  const rng = mulberry32(count);
  const boxes = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = rng() * 10000;
    const y = rng() * 10000;
    boxes.set([x, y, x + rng() * 300, y + rng() * 300], i * 4);
  }
  return boxes;
};

const build = (boxes: Float64Array, items: Uint32Array) => {
  const work: PackedRTreeBuildWork = { comparisons: 0, writes: 0 };
  const steps = PackedRTree.build(boxes, items, work);
  const perStep: number[] = [];
  for (;;) {
    const before = work.comparisons + work.writes;
    const step = steps.next();
    perStep.push(work.comparisons + work.writes - before);
    if (step.done) {
      return { tree: step.value, perStep, work };
    }
  }
};

describe("PackedRTree.build", () => {
  it("pauses after a bounded amount of work at every step", () => {
    const count = 50_000;
    const { perStep, work } = build(
      randomBoxes(count),
      Uint32Array.from({ length: count }, (_, i) => i),
    );

    expect(Math.max(...perStep)).toBeLessThanOrEqual(
      PACKED_RTREE_BUILD_CHUNK + 1,
    );
    expect(work.comparisons).toBeGreaterThan(count * 10);
  });

  it("finds the items a scan of every box finds", () => {
    const count = 3000;
    const boxes = randomBoxes(count);
    const items = Uint32Array.from({ length: count }, (_, i) => i).filter(
      (i) => i % 7 !== 0,
    );
    const { tree } = build(boxes, items);
    const rng = mulberry32(1);
    for (let query = 0; query < 200; query++) {
      const minX = rng() * 10000;
      const minY = rng() * 10000;
      const maxX = minX + rng() * 2000;
      const maxY = minY + rng() * 2000;
      const found: number[] = [];
      tree.search(minX, minY, maxX, maxY, (item) => found.push(item));
      const expected = [...items]
        .sort((a, b) => a - b)
        .filter(
          (i) =>
            boxes[i * 4] <= maxX &&
            boxes[i * 4 + 1] <= maxY &&
            boxes[i * 4 + 2] >= minX &&
            boxes[i * 4 + 3] >= minY,
        );
      expect(found.sort((a, b) => a - b)).toEqual(expected);
    }
  });
});
