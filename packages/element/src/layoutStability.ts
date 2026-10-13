export type PlacedBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type Placement = ReadonlyMap<string, PlacedBox>;

type Point = { readonly x: number; readonly y: number };

const centerOf = ({ x, y, width, height }: PlacedBox): Point => ({
  x: x + width / 2,
  y: y + height / 2,
});

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** the translation most of `ids` moved by: a whole drawing slid over, not rearranged */
export const commonShift = (
  before: Placement,
  after: Placement,
  ids: readonly string[],
): Point => ({
  x: median(ids.map((id) => after.get(id)!.x - before.get(id)!.x)),
  y: median(ids.map((id) => after.get(id)!.y - before.get(id)!.y)),
});

/**
 * How far each of `ids` moved between two placements, by center, in pixels,
 * after taking `shift` off; `moved` counts those that moved at least a pixel.
 */
export const displacement = (
  before: Placement,
  after: Placement,
  ids: readonly string[],
  shift: Point = { x: 0, y: 0 },
) => {
  const moves = ids.map((id) => {
    const from = centerOf(before.get(id)!);
    const to = centerOf(after.get(id)!);
    return Math.hypot(to.x - shift.x - from.x, to.y - shift.y - from.y);
  });
  return {
    mean: moves.reduce((sum, move) => sum + move, 0) / moves.length,
    max: Math.max(...moves),
    moved: moves.filter((move) => move >= 1).length,
  };
};

/**
 * Layers of a top-down layout: nodes whose centers share a row within
 * `tolerance`, each layer ordered left to right.
 */
export const layersOf = (
  placement: Placement,
  ids: readonly string[],
  tolerance: number,
): string[][] => {
  const byRow = [...ids].sort(
    (a, b) => centerOf(placement.get(a)!).y - centerOf(placement.get(b)!).y,
  );
  const layers: string[][] = [];
  let rowY = -Infinity;
  for (const id of byRow) {
    const { y } = centerOf(placement.get(id)!);
    if (y - rowY > tolerance) {
      layers.push([]);
      rowY = y;
    }
    layers[layers.length - 1].push(id);
  }
  return layers.map((layer) =>
    layer.sort(
      (a, b) => centerOf(placement.get(a)!).x - centerOf(placement.get(b)!).x,
    ),
  );
};

/**
 * Pairs of `ids` whose relative order the move reversed. Within a layer of
 * `before` that is left-right order, summarised as Kendall's tau over all
 * same-layer pairs (1: order kept, -1: mirrored). Across layers it is
 * above-below order.
 */
export const orderInversions = (
  before: Placement,
  after: Placement,
  ids: readonly string[],
  tolerance: number,
) => {
  const at = (placement: Placement, id: string) => centerOf(placement.get(id)!);
  const layers = layersOf(before, ids, tolerance);
  let pairs = 0;
  let withinLayer = 0;
  for (const layer of layers) {
    layer.forEach((left, i) =>
      layer.slice(i + 1).forEach((right) => {
        pairs++;
        if (at(after, left).x > at(after, right).x) {
          withinLayer++;
        }
      }),
    );
  }
  let acrossLayers = 0;
  layers.forEach((upper, i) =>
    layers.slice(i + 1).forEach((lower) =>
      upper.forEach((above) =>
        lower.forEach((below) => {
          if (at(after, above).y - at(after, below).y > tolerance) {
            acrossLayers++;
          }
        }),
      ),
    ),
  );
  return {
    withinLayer,
    acrossLayers,
    kendallTau: pairs ? (pairs - 2 * withinLayer) / pairs : 1,
  };
};

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const properlyIntersect = (p1: Point, p2: Point, q1: Point, q2: Point) =>
  cross(p1, p2, q1) * cross(p1, p2, q2) < 0 &&
  cross(q1, q2, p1) * cross(q1, q2, p2) < 0;

/** crossings between straight center-to-center edges; edges sharing a node never count */
export const edgeCrossings = (
  placement: Placement,
  edges: readonly { readonly source: string; readonly target: string }[],
) => {
  let crossings = 0;
  edges.forEach((e, i) =>
    edges.slice(i + 1).forEach((f) => {
      const shared = [e.source, e.target].some(
        (id) => id === f.source || id === f.target,
      );
      if (
        !shared &&
        properlyIntersect(
          centerOf(placement.get(e.source)!),
          centerOf(placement.get(e.target)!),
          centerOf(placement.get(f.source)!),
          centerOf(placement.get(f.target)!),
        )
      ) {
        crossings++;
      }
    }),
  );
  return crossings;
};
