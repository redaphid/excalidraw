import React from "react";
import {
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type LocalPoint,
} from "@excalidraw/math";
import {
  getContainingFrame,
  getDiamondPoints,
  getElementBounds,
  getElementDetailScale,
  getElementHitSlack,
  getElementPaintBounds,
  getFreedrawFillPolygon,
  getElementStrokeHitThreshold,
  getBoundTextElement,
  isCursorInFrame,
  isElbowArrow,
  isFrameLikeElement,
  isIframeLikeElement,
  isTextElement,
  newElementWith,
  syncInvalidIndices,
} from "@excalidraw/element";
import {
  DEFAULT_COLLISION_THRESHOLD,
  ROUNDNESS,
  type Bounds,
} from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  act,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
} from "./test-utils";

import type { NormalizedZoomValue } from "../types";

unmountComponent();

const { h } = window;

type Opts = {
  includeBoundTextElement?: boolean;
  includeLockedElements?: boolean;
};

/** `getElementsAtPosition` before it took candidates from the index: every
 * element through `hitElement` */
const scanElementsAtPosition = (x: number, y: number, opts: Opts) => {
  const app = h.app;
  const iframeLikes: ExcalidrawElement[] = [];
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const hits: ExcalidrawElement[] = app.scene
    .getNonDeletedElements()
    .filter(
      (element) =>
        (opts.includeLockedElements || !element.locked) &&
        (opts.includeBoundTextElement ||
          !(isTextElement(element) && element.containerId)),
    )
    .filter((element) => app.hitElement(x, y, element))
    .filter((element) => {
      const containingFrame = getContainingFrame(element, elementsMap);
      return containingFrame &&
        app.state.frameRendering.enabled &&
        app.state.frameRendering.clip &&
        !isIframeLikeElement(element)
        ? isCursorInFrame(
            { x, y },
            containingFrame as NonDeleted<ExcalidrawFrameLikeElement>,
            elementsMap,
          )
        : true;
    })
    .filter((element) => {
      if (isIframeLikeElement(element)) {
        iframeLikes.push(element);
        return false;
      }
      return true;
    });
  return [...hits, ...iframeLikes];
};

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = ReturnType<typeof mulberry32>;

const between = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);

const pick = <T,>(rng: Rng, items: readonly T[]) =>
  items[Math.floor(rng() * items.length)];

const zoomThreshold = () =>
  0.85 * (DEFAULT_COLLISION_THRESHOLD / h.state.zoom.value);

const ARROWHEADS = [
  null,
  "arrow",
  "triangle",
  "bar",
  "circle",
  "diamond",
] as const;

const randomPath = (rng: Rng, size: number, closed: boolean) => {
  const count = closed ? 3 + Math.floor(rng() * 8) : 1 + Math.floor(rng() * 8);
  const points = [pointFrom<LocalPoint>(0, 0)];
  for (let i = 1; i < count; i++) {
    points.push(
      pointFrom<LocalPoint>(
        between(rng, -1, 1) * size,
        between(rng, -1, 1) * size,
      ),
    );
  }
  if (closed) {
    points.push(pointFrom<LocalPoint>(0, 0));
  }
  return points;
};

/** a random element and, for a container, its label */
const randomElements = (
  rng: Rng,
  frames: readonly ExcalidrawElement[],
): ExcalidrawElement[] => {
  const size = 10 ** between(rng, -1, 2.7);
  const x = between(rng, -1000, 1000);
  const y = between(rng, -1000, 1000);
  const authoringScale = rng() < 0.3 ? 10 ** between(rng, -2, 2) : undefined;
  const scale = authoringScale ?? 1;
  const frame = frames.find(
    (frame) =>
      x > frame.x &&
      y > frame.y &&
      x < frame.x + frame.width &&
      y < frame.y + frame.height,
  );
  const common = {
    x,
    y,
    width: size,
    height: size * between(rng, 0.2, 2),
    angle: rng() < 0.4 ? between(rng, 0, Math.PI * 2) : 0,
    strokeWidth: pick(rng, [0.5, 1, 2, 4, 16]) * scale * (rng() < 0.1 ? 20 : 1),
    roughness: pick(rng, [0, 0, 1, 2]),
    roundness: rng() < 0.4 ? { type: ROUNDNESS.PROPORTIONAL_RADIUS } : null,
    backgroundColor: rng() < 0.5 ? "transparent" : "#ffc9c9",
    groupIds: rng() < 0.2 ? [pick(rng, ["g1", "g2"])] : [],
    frameId: frame && rng() < 0.7 ? frame.id : null,
    locked: rng() < 0.1,
  };
  const scaled = <T extends ExcalidrawElement>(element: T): T =>
    authoringScale === undefined ? element : { ...element, authoringScale };

  const kind = Math.floor(rng() * 12);
  if (kind === 0 || kind === 1) {
    const closed = rng() < 0.5;
    return [
      scaled(
        API.createElement({
          ...common,
          type: "freedraw",
          points: randomPath(rng, size, closed),
        }),
      ),
    ];
  }
  if (kind === 2) {
    return [
      scaled(
        API.createElement({
          ...common,
          type: "line",
          points: randomPath(rng, size, rng() < 0.5),
        }),
      ),
    ];
  }
  if (kind === 3 || kind === 4) {
    const container = scaled<ExcalidrawElement>(
      kind === 3
        ? API.createElement({
            ...common,
            type: "arrow",
            points: randomPath(rng, size, false).slice(0, 4),
            startArrowhead: pick(rng, ARROWHEADS),
            endArrowhead: pick(rng, ARROWHEADS),
          })
        : API.createElement({
            ...common,
            type: pick(rng, ["rectangle", "ellipse"] as const),
          }),
    );
    if (rng() < 0.4) {
      return [container];
    }
    // labels from well inside their container to far past it
    const label = API.createElement({
      type: "text",
      text: "a label",
      x: x + between(rng, -0.5, 1) * size,
      y: y + between(rng, -0.5, 1) * size,
      fontSize: (size / between(rng, 1, 8)) as never,
      angle: container.angle,
      containerId: container.id,
      groupIds: common.groupIds,
      frameId: common.frameId,
      locked: common.locked,
    });
    return [
      { ...container, boundElements: [{ id: label.id, type: "text" }] },
      label,
    ];
  }
  if (kind === 5) {
    return [
      API.createElement({
        ...common,
        type: "text",
        text: "standalone",
        fontSize: (size / 4) as never,
      }),
    ];
  }
  if (kind === 11) {
    // drawn with its vertices rounded off the box midpoints
    return [
      scaled(
        API.createElement({
          ...common,
          type: "diamond",
          angle: between(rng, 0, Math.PI * 2),
          roughness: 0,
          roundness: null,
        }),
      ),
    ];
  }
  if (kind === 10) {
    // the editor never rotates an elbow arrow, but imported data can
    const consistent = rng() < 0.5;
    return [
      API.createElement({
        ...common,
        type: "arrow",
        elbowed: true,
        roundness: null,
        angle: rng() < 0.7 ? between(rng, 0, Math.PI * 2) : 0,
        width: consistent ? size * 2 : size,
        height: consistent ? size : common.height,
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(size, 0),
          pointFrom<LocalPoint>(size, size),
          pointFrom<LocalPoint>(size * 2, size),
        ],
        endArrowhead: pick(rng, ARROWHEADS),
      }),
    ];
  }
  if (kind === 6) {
    return [
      API.createElement({
        ...common,
        type: pick(rng, ["embeddable", "image"] as const),
      }),
    ];
  }
  return [
    scaled(
      API.createElement({
        ...common,
        type: pick(rng, ["rectangle", "ellipse", "diamond"] as const),
      }),
    ),
  ];
};

const randomBoard = (rng: Rng, count: number) => {
  const frames = [
    API.createElement({
      type: "frame",
      x: -900,
      y: -700,
      width: 800,
      height: 900,
    }),
    API.createElement({
      type: "frame",
      x: 200,
      y: 100,
      width: 600,
      height: 500,
    }),
  ];
  const elements: ExcalidrawElement[] = [];
  while (elements.length < count) {
    elements.push(...randomElements(rng, frames));
  }
  return [...elements, ...frames];
};

/** a point near an edge, corner or label of an element, or above a frame
 * where its name sits, and now and then anywhere */
/** a diamond's drawn vertices, or a rotated elbow arrow's points, where the
 * hit test looks for them */
const hitShapeCorners = (element: ExcalidrawElement): [number, number][] => {
  if (element.type === "diamond") {
    const [tx, ty, rx, ry, bx, by, lx, ly] = getDiamondPoints(element);
    const center = pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
    return [
      [tx, ty],
      [rx, ry],
      [bx, by],
      [lx, ly],
    ].map(([x, y]) =>
      pointRotateRads(
        pointFrom<GlobalPoint>(element.x + x, element.y + y),
        center,
        element.angle,
      ),
    );
  }
  if (isElbowArrow(element) && element.angle !== 0) {
    return element.points.map(([x, y]) => [element.x + x, element.y + y]);
  }
  return [];
};

const randomPoint = (rng: Rng): [number, number] => {
  const elements = h.app.scene.getNonDeletedElements();
  const elementsMap = h.app.scene.getNonDeletedElementsMap();
  if (rng() < 0.05 || !elements.length) {
    return [between(rng, -1200, 1200), between(rng, -1200, 1200)];
  }
  const anchor = pick(rng, elements);
  const zoom = h.state.zoom.value;
  if (isFrameLikeElement(anchor) && rng() < 0.5) {
    return [
      anchor.x + between(rng, -0.2, 1.2) * (150 / zoom),
      anchor.y - between(rng, -0.2, 1.2) * (60 / zoom),
    ];
  }
  const corners = hitShapeCorners(anchor);
  if (corners.length && rng() < 0.4) {
    // just inside or outside the hit area around a corner of the shape the
    // hit test tests, which can stray from the element's bounds
    const [cx, cy] = pick(rng, corners);
    const threshold = Math.max(
      getElementStrokeHitThreshold(anchor),
      zoomThreshold(),
    );
    const distance = threshold * between(rng, 0.6, 1.05);
    const direction = between(rng, 0, Math.PI * 2);
    return [
      cx + Math.cos(direction) * distance,
      cy + Math.sin(direction) * distance,
    ];
  }
  const [x1, y1, x2, y2] = getElementPaintBounds(anchor, elementsMap);
  // reaches at least as far as any hit can, without asking the code under
  // test: the zoom's and the element's own threshold, a diamond's vertex
  // rounding, and a rotated elbow arrow's unrotated hit shape
  const reach =
    zoomThreshold() +
    getElementStrokeHitThreshold(anchor) +
    getElementDetailScale(anchor) +
    (isElbowArrow(anchor) && anchor.angle !== 0
      ? Math.hypot(anchor.width, anchor.height) / 2
      : 0);
  const band =
    reach * (rng() < 0.5 ? between(rng, 0, 1.5) : between(rng, 0, 1.05));
  const across = (min: number, max: number) =>
    rng() < 0.6
      ? pick(rng, [min - band, max + band])
      : between(rng, min - band, max + band);
  return rng() < 0.5
    ? [across(x1, x2), between(rng, y1 - band, y2 + band)]
    : [between(rng, x1 - band, x2 + band), across(y1, y2)];
};

/** why the scan hit an element from outside its paint bounds grown by the
 * zoom threshold, which only the slack or the always-included ids find */
const farHitKind = (
  element: ExcalidrawElement,
  x: number,
  y: number,
): string | null => {
  const elementsMap = h.app.scene.getNonDeletedElementsMap();
  const grow = zoomThreshold();
  const [x1, y1, x2, y2] = getElementPaintBounds(element, elementsMap);
  if (x >= x1 - grow && x <= x2 + grow && y >= y1 - grow && y <= y2 + grow) {
    return null;
  }
  if (isFrameLikeElement(element)) {
    return "frame name";
  }
  if (h.state.selectedElementIds[element.id]) {
    return "selection box";
  }
  const label = getBoundTextElement(element, elementsMap);
  if (label) {
    const [lx1, ly1, lx2, ly2] = getElementPaintBounds(label, elementsMap);
    if (x >= lx1 && x <= lx2 && y >= ly1 && y <= ly2) {
      return "label";
    }
  }
  if (element.type === "diamond") {
    return "diamond vertex";
  }
  if (isElbowArrow(element) && element.angle !== 0) {
    return "rotated elbow";
  }
  const own = getElementStrokeHitThreshold(element);
  if (
    element.type === "freedraw" &&
    (x < x1 - own - grow ||
      x > x2 + own + grow ||
      y < y1 - own - grow ||
      y > y2 + own + grow)
  ) {
    return "fill bulge";
  }
  return "slack";
};

const ids = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => element.id).join(",");

/** the furthest point from (x, y) along (dx, dy), in steps of a hundredth of
 * the zoom's threshold, that the scan still finds an element at */
const furthestHit = (
  x: number,
  y: number,
  dx: number,
  dy: number,
): [number, number] => {
  const step = zoomThreshold() / 100;
  let last: [number, number] | null = null;
  for (let i = 0; i < 1e5; i++) {
    const point: [number, number] = [x + dx * step * i, y + dy * step * i];
    if (scanElementsAtPosition(point[0], point[1], {}).length) {
      last = point;
    } else if (last) {
      return last;
    }
  }
  throw new Error("no edge to the hit area");
};

const forceRebuild = () =>
  (
    h.app.renderer as unknown as { elementsTree: { rebuild(): void } }
  ).elementsTree.rebuild();

/** an in-place edit, a replaced element, a deletion, an addition or a
 * rebuild of the index */
const randomEdit = (rng: Rng) => {
  const elements = h.app.scene.getNonDeletedElements();
  const target = pick(rng, elements);
  const move = between(rng, -50, 50);
  const edit = Math.floor(rng() * 5);
  if (edit === 0) {
    act(() => {
      h.app.scene.mutateElement(target, {
        x: target.x + move,
        angle: rng() < 0.5 ? target.angle : (between(rng, 0, 6) as never),
      });
    });
  } else if (edit === 1) {
    API.updateScene({
      elements: h.app.scene
        .getElementsIncludingDeleted()
        .map((element) =>
          element === target
            ? newElementWith(element, { y: element.y + move })
            : element,
        ),
    });
  } else if (edit === 2 && !isFrameLikeElement(target)) {
    API.updateScene({
      elements: h.app.scene
        .getElementsIncludingDeleted()
        .map((element) =>
          element === target
            ? newElementWith(element, { isDeleted: true })
            : element,
        ),
    });
  } else if (edit === 3) {
    API.updateScene({
      elements: syncInvalidIndices([
        ...h.app.scene.getElementsIncludingDeleted(),
        ...randomElements(rng, []),
      ]),
    });
  } else {
    forceRebuild();
  }
};

type FuzzResult = {
  compared: number;
  hits: number;
  mismatches: number;
  firstMismatch: string | null;
  farHits: Record<string, number>;
};

const fuzz = (seed: number, boards: number, steps: number): FuzzResult => {
  const rng = mulberry32(seed);
  const result: FuzzResult = {
    compared: 0,
    hits: 0,
    mismatches: 0,
    firstMismatch: null,
    farHits: {},
  };
  for (let board = 0; board < boards; board++) {
    API.setElements(randomBoard(rng, 140));
    if (rng() < 0.7) {
      forceRebuild();
    }
    for (let step = 0; step < steps; step++) {
      const elements = h.app.scene.getNonDeletedElements();
      const selected = elements.filter(() => rng() < 0.08);
      // zoomed far in, an element's own threshold outgrows the zoom's
      const zoom =
        10 ** (rng() < 0.4 ? between(rng, 0.5, 2) : between(rng, -1.3, 2));
      API.setAppState({
        zoom: { value: zoom as NormalizedZoomValue },
        selectedElementIds: Object.fromEntries(
          selected.map((element) => [element.id, true as const]),
        ),
        frameRendering: {
          ...h.state.frameRendering,
          clip: rng() < 0.7,
        },
      });
      for (let i = 0; i < 60; i++) {
        const [x, y] = randomPoint(rng);
        const opts: Opts = {
          includeBoundTextElement: rng() < 0.5,
          includeLockedElements: rng() < 0.5,
        };
        const expected = scanElementsAtPosition(x, y, opts);
        const actual = h.app.getElementsAtPosition(x, y, opts);
        result.compared++;
        result.hits += expected.length;
        for (const element of expected) {
          const kind = farHitKind(element, x, y);
          if (kind) {
            result.farHits[kind] = (result.farHits[kind] ?? 0) + 1;
          }
        }
        if (ids(expected) !== ids(actual)) {
          result.mismatches++;
          result.firstMismatch ??= `board ${board} step ${step} at (${x}, ${y}) zoom ${
            h.state.zoom.value
          }: scan [${ids(expected)}], index [${ids(actual)}]`;
        }
      }
      randomEdit(rng);
    }
  }
  return result;
};

type Renderer = typeof h.app.renderer;

/** runs `run` with the renderer's candidate query swapped for `query` */
const withCandidates = <T,>(
  query: (
    original: Renderer["getHitTestCandidates"],
    rect: Bounds,
    alwaysIncluded: ReadonlySet<string> | null,
  ) => readonly NonDeletedExcalidrawElement[],
  run: () => T,
): T => {
  const renderer = h.app.renderer;
  const original = renderer.getHitTestCandidates;
  renderer.getHitTestCandidates = ((rect, alwaysIncluded) =>
    query(
      original.bind(renderer),
      rect,
      alwaysIncluded,
    )) as Renderer["getHitTestCandidates"];
  try {
    return run();
  } finally {
    renderer.getHitTestCandidates = original;
  }
};

describe("getElementsAtPosition", () => {
  beforeAll(() => {
    // frame names get a size, so their hit area reaches past the frame
    mockBoundingClientRect({
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 150,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("finds what a scan of every element finds, in order, across random boards, zooms, selections and edits", () => {
    const result = fuzz(109, 6, 12);
    expect(result.firstMismatch).toBe(null);
    expect(result.mismatches).toBe(0);
    expect(result.compared).toBe(6 * 12 * 60);
    expect(result.hits).toBeGreaterThan(1000);
    // the scan hit elements in every way that lies past an element's paint
    // bounds grown by the zoom threshold
    expect(result.farHits["diamond vertex"]).toBeGreaterThan(0);
    expect(result.farHits["rotated elbow"]).toBeGreaterThan(0);
    expect(result.farHits["frame name"]).toBeGreaterThan(0);
    expect(result.farHits["selection box"]).toBeGreaterThan(0);
    expect(result.farHits.label).toBeGreaterThan(0);
  }, 120_000);

  it("selects a rotated architect diamond where master does", () => {
    // from the review of #175: the drawn vertices sit up to one nominal unit
    // off the box midpoints its bounds are built from
    const diamond = API.createElement({
      type: "diamond",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      angle: 0.5,
      strokeWidth: 2,
      roughness: 0,
      roundness: null,
    });
    API.setElements([diamond]);
    forceRebuild();
    API.setAppState({ zoom: { value: 30 as NormalizedZoomValue } });
    expect(ids(scanElementsAtPosition(4.746, 6.73, {}))).toBe(diamond.id);
    expect(h.app.getElementAtPosition(4.746, 6.73)?.id).toBe(diamond.id);
  }, 120_000);

  it("finds what the scan finds around the edge of single elements whose hit shape is not their bounds' shape", () => {
    const architect = {
      x: 0,
      y: 0,
      strokeWidth: 2,
      roughness: 0,
      roundness: null,
    } as const;
    const elbow = (width: number, height: number, size: number) =>
      API.createElement({
        ...architect,
        type: "arrow",
        elbowed: true,
        width,
        height,
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(size, 0),
          pointFrom<LocalPoint>(size, size),
          pointFrom<LocalPoint>(size * 2, size),
        ],
      });
    const cases: [ExcalidrawElement, number][] = [];
    for (const [width, height, angle, zoom] of [
      [100, 60, 0.5, 10],
      [100, 60, 0.5, 30],
      [101, 61, 0.7, 30],
      [37, 23, 1, 30],
      [100, 60, 2, 50],
      [100, 60, 0.5, 1000],
      [1.5, 1.2, 0, 1000],
      [1.5, 1.2, 0.8, 1000],
    ] as const) {
      cases.push([
        API.createElement({
          ...architect,
          type: "diamond",
          width,
          height,
          angle: angle as never,
        }),
        zoom,
      ]);
      cases.push([
        {
          ...API.createElement({
            ...architect,
            type: "diamond",
            width: width * 10,
            height: height * 10,
            angle: angle as never,
          }),
          authoringScale: 10,
        },
        zoom,
      ]);
    }
    for (const angle of [0, 0.4, 1.3, 2.6, 4]) {
      for (const zoom of [1, 20, 300]) {
        cases.push([{ ...elbow(200, 100, 100), angle: angle as never }, zoom]);
        cases.push([{ ...elbow(100, 37, 100), angle: angle as never }, zoom]);
      }
    }
    for (const type of ["rectangle", "ellipse", "stickynote"] as const) {
      cases.push([
        API.createElement({
          ...architect,
          type,
          width: 100,
          height: 60,
          angle: 0.5 as never,
        }),
        30,
      ]);
    }
    cases.push([
      API.createElement({
        ...architect,
        type: "line",
        width: 100,
        height: 60,
        angle: 0.9 as never,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 60)],
      }),
      30,
    ]);

    const misses: string[] = [];
    let hits = 0;
    for (const [element, zoom] of cases) {
      API.setElements([element]);
      forceRebuild();
      API.setAppState({
        zoom: { value: zoom as NormalizedZoomValue },
        selectedElementIds: {},
      });
      const elementsMap = h.app.scene.getNonDeletedElementsMap();
      const [x1, y1, x2, y2] = getElementPaintBounds(element, elementsMap);
      const reach =
        zoomThreshold() + Math.max(getElementHitSlack(element, elementsMap), 3);
      // the paint box's perimeter, grown by up to 1.2 times the reach
      for (let ring = 0; ring <= 24; ring++) {
        const g = (ring / 20) * reach;
        for (let k = 0; k <= 200; k++) {
          const t = k / 200;
          for (const [x, y] of [
            [x1 - g + (x2 - x1 + 2 * g) * t, y1 - g],
            [x1 - g + (x2 - x1 + 2 * g) * t, y2 + g],
            [x1 - g, y1 - g + (y2 - y1 + 2 * g) * t],
            [x2 + g, y1 - g + (y2 - y1 + 2 * g) * t],
          ]) {
            const expected = ids(scanElementsAtPosition(x, y, {}));
            hits += expected ? 1 : 0;
            if (expected !== ids(h.app.getElementsAtPosition(x, y))) {
              misses.push(
                `${element.type} ${element.width}x${element.height} angle ${element.angle} zoom ${zoom} at (${x}, ${y})`,
              );
            }
          }
        }
      }
    }
    const byCase: Record<string, number> = {};
    for (const miss of misses) {
      const key = miss.slice(0, miss.indexOf(" at "));
      byCase[key] = (byCase[key] ?? 0) + 1;
    }
    expect(byCase).toEqual({});
    expect(hits).toBeGreaterThan(10_000);
  }, 600_000);

  it("finds a rotated freedraw loop by its fill where the fill bulges past the stroke", () => {
    // found by a random search: its fill reaches 38 units past its paint
    // bounds grown by its whole threshold
    const loop = API.createElement({
      type: "freedraw",
      x: 0,
      y: 0,
      width: 475,
      height: 529,
      angle: 2.065320501830429,
      strokeWidth: 2,
      backgroundColor: "#ffc9c9",
      points: (
        [
          [0, 0],
          [247, -253],
          [-21, 276],
          [-213, -120],
          [109, -209],
          [262, -251],
          [0, 0],
        ] as const
      ).map(([x, y]) => pointFrom<LocalPoint>(x, y)),
    });
    API.setElements([loop]);
    API.setAppState({ zoom: { value: 50 as NormalizedZoomValue } });
    const elementsMap = h.app.scene.getNonDeletedElementsMap();
    const [x1, y1, x2, y2] = getElementPaintBounds(loop, elementsMap);
    const reach = zoomThreshold() + getElementStrokeHitThreshold(loop);
    const [ux1, uy1, ux2, uy2] = getElementBounds(loop, elementsMap, true);
    const [cx, cy] = [(ux1 + ux2) / 2, (uy1 + uy2) / 2];
    const center = pointFrom<GlobalPoint>(cx, cy);
    // fill outline points, a hair inside the fill, that lie further past the
    // paint bounds than the element's whole threshold
    const bulging = getFreedrawFillPolygon(loop)
      .map(([x, y]) =>
        pointRotateRads(
          pointFrom<GlobalPoint>(
            loop.x + x + (cx - loop.x - x) * 1e-2,
            loop.y + y + (cy - loop.y - y) * 1e-2,
          ),
          center,
          loop.angle,
        ),
      )
      .filter(
        ([x, y]) =>
          (x < x1 - reach ||
            x > x2 + reach ||
            y < y1 - reach ||
            y > y2 + reach) &&
          scanElementsAtPosition(x, y, {}).length === 1,
      );
    expect(bulging.length).toBeGreaterThan(10);
    for (const [x, y] of bulging) {
      expect(ids(h.app.getElementsAtPosition(x, y))).toBe(loop.id);
    }
  }, 120_000);

  it("detects candidates queried with a margin a tenth too small", () => {
    // at zoom 1 the zoom's threshold outreaches the rectangle's own
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 1,
      roughness: 0,
      backgroundColor: "transparent",
    });
    API.setElements([rectangle]);
    API.setAppState({ zoom: { value: 1 as NormalizedZoomValue } });
    const [x, y] = furthestHit(100, 50, 1, 0);
    expect(ids(h.app.getElementsAtPosition(x, y))).toBe(rectangle.id);
    const tight = withCandidates(
      (original, [x1, y1, x2, y2], alwaysIncluded) => {
        const shrink = ((x2 - x1) / 2) * 0.1;
        return original(
          [x1 + shrink, y1 + shrink, x2 - shrink, y2 - shrink],
          alwaysIncluded,
        );
      },
      () => h.app.getElementsAtPosition(x, y),
    );
    expect(ids(tight)).toBe("");
  }, 120_000);

  it("detects candidates queried without the elements' slack", () => {
    // zoomed far in on a rectangle drawn far out, its own threshold
    // outreaches the zoom's
    const rectangle = {
      ...API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        strokeWidth: 1,
        roughness: 0,
        backgroundColor: "transparent",
      }),
      authoringScale: 100,
    };
    API.setElements([rectangle]);
    API.setAppState({ zoom: { value: 100 as NormalizedZoomValue } });
    const [x, y] = furthestHit(100, 50, 1, 0);
    const [, , paintRight] = getElementPaintBounds(
      rectangle,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect(x - paintRight).toBeGreaterThan(10 * zoomThreshold());
    expect(ids(h.app.getElementsAtPosition(x, y))).toBe(rectangle.id);
    const withoutSlack = withCandidates(
      (_original, rect, alwaysIncluded) =>
        (
          h.app.renderer as unknown as {
            elementsTree: {
              collect(
                elements: readonly NonDeletedExcalidrawElement[],
                elementsMap: unknown,
                rect: Bounds,
                alwaysIncluded: ReadonlySet<string> | null,
                withSlack: boolean,
              ): NonDeletedExcalidrawElement[];
            };
          }
        ).elementsTree.collect(
          h.app.scene.getNonDeletedElements(),
          h.app.scene.getNonDeletedElementsMap(),
          rect,
          alwaysIncluded,
          false,
        ),
      () => h.app.getElementsAtPosition(x, y),
    );
    expect(ids(withoutSlack)).toBe("");
  }, 120_000);

  it("detects candidates queried without frames, selected elements and label containers", () => {
    const result = withCandidates(
      (original, rect) => original(rect, null),
      () => fuzz(109, 2, 8),
    );
    expect(result.mismatches).toBeGreaterThan(0);
  }, 120_000);
});
