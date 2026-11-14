// Arranging what is arranged moves nothing. Each scene is arranged twice and
// the second arrange must change no element; the first must leave no element
// outside its frame that lay inside it, and no locked frame changed.
import React from "react";

import { CaptureUpdateAction, isFrameLikeElement } from "@excalidraw/element";

import type { LayoutDirection } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { arrowBetween, frame } from "./helpers/frames";
import { act, render } from "./test-utils";

const { h } = window;

type Scene = ReadonlyMap<string, ExcalidrawElement>;

const snapshot = (): Scene =>
  new Map(h.elements.map((element) => [element.id, { ...element }]));

const geometry = (element: ExcalidrawElement) =>
  JSON.stringify([
    element.x,
    element.y,
    element.width,
    element.height,
    "points" in element ? element.points : null,
  ]);

const changed = (before: Scene, after: Scene) =>
  [...after.values()]
    .filter(
      (element) => geometry(before.get(element.id)!) !== geometry(element),
    )
    .map((element) => element.id);

const holds = (outer: ExcalidrawElement, inner: ExcalidrawElement) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/** shapes not wholly inside the frame their frameId names */
const outsideTheirFrame = (scene: Scene) =>
  [...scene.values()]
    .filter((element) => element.frameId && !("points" in element))
    .filter((element) => !holds(scene.get(element.frameId!)!, element))
    .map((element) => element.id);

const rect = (
  id: string,
  [x, y]: [number, number],
  [width, height]: [number, number],
  frameId: string | null,
  extra: Partial<ExcalidrawElement> = {},
) =>
  ({
    ...API.createElement({ type: "rectangle", id, x, y, width, height }),
    frameId,
    ...extra,
  } as ExcalidrawElement);

/** a frame with `count` shapes in a chain, which arranging grows right and down */
const grower = (
  id: string,
  [x, y]: [number, number],
  [width, height]: [number, number],
  count: number,
  extra: Partial<ExcalidrawElement> = {},
): ExcalidrawElement[] => [
  { ...frame(id, x, y, width, height), ...extra } as ExcalidrawElement,
  ...Array.from({ length: count }, (_, i) => [
    rect(
      `${id}-s${i}`,
      [x + 20 + (i % 3) * 50, y + 20 + (i % 2) * 30],
      [120, 80],
      id,
    ),
    ...(i
      ? [
          arrowBetween(
            `${id}-a${i}`,
            `${id}-s${i - 1}`,
            `${id}-s${i}`,
          ) as ExcalidrawElement,
        ]
      : []),
  ]).flat(),
];

const arrangeTwice = async (
  elements: readonly ExcalidrawElement[],
  request: { elementIds?: string[]; direction?: LayoutDirection } = {},
) => {
  await render(<Excalidraw />);
  API.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  const before = snapshot();
  await act(async () => {
    await h.app.api.arrange(request);
  });
  const after = snapshot();
  await act(async () => {
    await h.app.api.arrange(request);
  });
  return { before, after, again: snapshot() };
};

const expectStable = ({
  before,
  after,
  again,
}: Awaited<ReturnType<typeof arrangeTwice>>) => {
  expect(changed(after, again)).toEqual([]);
  const wasOutside = new Set(outsideTheirFrame(before));
  expect(outsideTheirFrame(after).filter((id) => !wasOutside.has(id))).toEqual(
    [],
  );
  expect(
    changed(before, after).filter(
      (id) => before.get(id)!.locked && isFrameLikeElement(before.get(id)!),
    ),
  ).toEqual([]);
};

describe("arranging the whole scene twice, where frames lie in or over others", () => {
  it("should hold a frame lying in two overlapping frames in the same one when the smaller grows past the other", async () => {
    const elements = [
      frame("frame-id-B", 0, 100, 500, 300),
      rect("shape-id-b1", [20, 300], [80, 60], "frame-id-B"),
      rect("shape-id-b2", [300, 320], [80, 60], "frame-id-B"),
      arrowBetween("arrow-id-b", "shape-id-b1", "shape-id-b2"),
      frame("frame-id-A", 100, 100, 500, 200),
      frame("frame-id-X", 150, 150, 60, 60),
      rect("shape-id-x", [160, 160], [30, 30], "frame-id-X"),
      ...Array.from({ length: 8 }, (_, i) => [
        rect(
          `shape-id-a${i}`,
          [420 + (i % 2) * 40, 120 + (i % 3) * 30],
          [100, 60],
          "frame-id-A",
        ),
        arrowBetween(
          `arrow-id-a${i}`,
          i ? `shape-id-a${i - 1}` : "shape-id-x",
          `shape-id-a${i}`,
        ),
      ]).flat(),
    ] as ExcalidrawElement[];
    const result = await arrangeTwice(elements);
    expectStable(result);
    expect(result.after.get("frame-id-X")!.frameId).toBe("frame-id-A");
  });

  it("should keep a small frame in the frame around it that is smallest, not the one an outer sheet nests deeper", async () => {
    const result = await arrangeTwice([
      frame("frame-id-S", 0, 0, 2000, 2000),
      rect("shape-id-s1", [40, 1500], [100, 60], "frame-id-S"),
      rect("shape-id-s2", [600, 1800], [100, 60], "frame-id-S"),
      arrowBetween("arrow-id-s", "shape-id-s1", "shape-id-s2"),
      frame("frame-id-B", 100, 100, 1800, 1100),
      rect("shape-id-b1", [150, 150], [100, 60], "frame-id-B"),
      rect("shape-id-b2", [500, 600], [100, 60], "frame-id-B"),
      arrowBetween("arrow-id-b", "shape-id-b1", "shape-id-b2"),
      frame("frame-id-A", 1700, 900, 400, 400),
      rect("shape-id-a1", [1960, 1150], [100, 60], "frame-id-A"),
      rect("shape-id-a2", [1720, 1200], [100, 60], "frame-id-A"),
      arrowBetween("arrow-id-a", "shape-id-a1", "shape-id-a2"),
      frame("frame-id-X", 1750, 950, 100, 100),
      rect("shape-id-x", [1760, 960], [40, 40], "frame-id-X"),
    ] as ExcalidrawElement[]);
    expectStable(result);
    expect(
      holds(result.after.get("frame-id-A")!, result.after.get("frame-id-X")!),
    ).toBe(true);
  });

  it.each([
    [
      "a frame grows wholly around a smaller locked frame",
      [
        ...grower("frame-id-G", [0, 0], [700, 200], 7),
        ...grower("frame-id-L", [40, 300], [200, 120], 0, { locked: true }),
      ],
    ],
    [
      "a frame grows down into a locked frame below it",
      [
        ...grower("frame-id-G", [0, 0], [600, 200], 6),
        ...grower("frame-id-L", [0, 260], [600, 200], 2, { locked: true }),
      ],
    ],
    [
      "a locked frame and the frame below it are both locked",
      [
        ...grower("frame-id-G", [0, 0], [300, 200], 6, { locked: true }),
        ...grower("frame-id-B", [0, 260], [300, 200], 2, { locked: true }),
      ],
    ],
    [
      "two frames have the same box",
      [
        ...grower("frame-id-A", [0, 0], [400, 300], 4),
        ...grower("frame-id-B", [0, 0], [400, 300], 3),
      ],
    ],
    [
      "two frames have the same box and one is empty",
      [
        ...grower("frame-id-A", [0, 0], [400, 300], 6),
        frame("frame-id-B", 0, 0, 400, 300),
      ],
    ],
    [
      "a frame lies inside another but for half a pixel, and the outer grows past it",
      [
        ...grower("frame-id-O", [0, 0], [1000, 300], 10),
        ...grower("frame-id-I", [500, 150], [300, 150.5], 2),
      ],
    ],
    [
      "a frame lies inside another but for 0.9 pixels, and the outer grows past it",
      [
        ...grower("frame-id-O", [0, 0], [1000, 300], 10),
        ...grower("frame-id-I", [500, 150], [300, 150.9], 2),
      ],
    ],
  ] as [string, ExcalidrawElement[]][])(
    "should move nothing the second time where %s",
    async (_, elements) => {
      expectStable(await arrangeTwice(elements));
    },
  );
});

describe("arranging the whole scene where a frame is drawn in another", () => {
  it("should write down the frame it is nested in", async () => {
    const { after } = await arrangeTwice([
      ...grower("frame-id-outer", [0, 0], [800, 600], 3),
      frame("frame-id-inner", 400, 300, 200, 150),
      rect("shape-id-in", [420, 320], [60, 40], "frame-id-inner"),
    ] as ExcalidrawElement[]);
    expect(after.get("frame-id-inner")!.frameId).toBe("frame-id-outer");
    expect(after.get("frame-id-outer")!.frameId).toBe(null);
  });

  it("should leave a frame dragged out of the frame its frameId names where it is", async () => {
    const result = await arrangeTwice([
      ...grower("frame-id-outer", [0, 0], [400, 300], 2),
      {
        ...frame("frame-id-dragged-out", 1000, 0, 200, 150),
        frameId: "frame-id-outer",
      },
    ] as ExcalidrawElement[]);
    expectStable(result);
    expect(changed(result.before, result.after)).not.toContain(
      "frame-id-dragged-out",
    );
    expect(result.after.get("frame-id-dragged-out")!.frameId).toBe(null);
  });
});

// Random scenes of 2 to 5 frames, some with a frame inside, some locked, with
// rotated and locked shapes, loose shapes, all four directions and, every
// fifth seed, one frame selected. Found holder flips, locked frames moved and
// a shape left outside its frame on earlier versions of arrange
const random = (seed: number) => {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const between = (low: number, high: number) =>
    Math.floor(low + next() * (high - low));
  return { next, between };
};

const randomScene = (seed: number) => {
  const { next, between } = random(seed);
  const elements: ExcalidrawElement[] = [];
  const chains: string[][] = [];
  const frames = between(2, 6);
  for (let f = 0; f < frames; f++) {
    const x = between(0, 3) * 450 + between(-60, 60);
    const y = between(0, 3) * 350 + between(-60, 60);
    const width = between(250, 450);
    const height = between(180, 350);
    const id = `frame-id-f${f}`;
    elements.push({
      ...frame(id, x, y, width, height),
      locked: next() < 0.15,
    } as ExcalidrawElement);
    const chain: string[] = [];
    for (let i = between(0, 7); i > 0; i--) {
      const shapeId = `shape-id-f${f}s${chain.length}`;
      elements.push(
        rect(
          shapeId,
          [x + between(5, width - 80), y + between(5, height - 50)],
          [between(40, 140), between(30, 90)],
          id,
          {
            locked: next() < 0.1,
            angle: (next() < 0.15 ? next() * 3 : 0) as any,
          },
        ),
      );
      chain.push(shapeId);
    }
    if (next() < 0.4) {
      const nestedX = x + between(10, width / 2);
      const nestedY = y + between(10, height / 2);
      elements.push(
        frame(
          `${id}n`,
          nestedX,
          nestedY,
          between(60, width / 2 - 10),
          between(50, height / 2 - 10),
        ) as ExcalidrawElement,
        rect(
          `shape-id-f${f}nc`,
          [nestedX + 5, nestedY + 5],
          [30, 30],
          `${id}n`,
        ),
      );
      chain.push(`shape-id-f${f}nc`);
    }
    chains.push(chain);
  }
  const loose: string[] = [];
  for (let i = 0; i < between(0, 8); i++) {
    loose.push(`shape-id-free${i}`);
    elements.push(
      rect(
        `shape-id-free${i}`,
        [between(-400, 1800), between(-400, 1400)],
        [between(40, 140), between(30, 90)],
        null,
        { locked: next() < 0.2 },
      ),
    );
  }
  chains.push(loose);
  let arrows = 0;
  for (const chain of chains) {
    for (let i = 1; i < chain.length; i++) {
      if (next() < 0.7) {
        elements.push(
          arrowBetween(
            `arrow-id-${arrows++}`,
            chain[between(0, i)],
            chain[i],
          ) as ExcalidrawElement,
        );
      }
    }
  }
  return elements;
};

const DIRECTIONS: LayoutDirection[] = ["down", "right", "up", "left"];

describe("arranging random scenes twice", () => {
  it.each(Array.from({ length: 120 }, (_, i) => i + 1))(
    "should move nothing the second time, seed %i",
    async (seed) => {
      const elements = randomScene(seed);
      expectStable(
        await arrangeTwice(elements, {
          direction: DIRECTIONS[seed % 4],
          ...(seed % 5 === 0 ? { elementIds: ["frame-id-f0"] } : {}),
        }),
      );
    },
  );
});
