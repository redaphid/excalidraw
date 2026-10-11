import React from "react";
import { vi } from "vitest";

import { KEYS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";
import {
  CaptureUpdateAction,
  applyArrangePlan,
  computeBoundTextPosition,
  distanceToElement,
  getBindingGap,
  isArrowElement,
  isBoundToContainer,
  planArrange,
} from "@excalidraw/element";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";
import type { ArrangeOutcome, LayoutEngine } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  FixedPointBinding,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { frame } from "./helpers/frames";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor } from "./queries/dom";
import { act, fireEvent, queryByTestId, render } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

type Kind = "rectangle" | "ellipse" | "diamond" | "stickynote";

type Shape = {
  id: string;
  type?: Kind;
  at: [number, number];
  size?: [number, number];
  label: string;
  frame?: string;
};

type Frame = { id: string; at: [number, number]; size: [number, number] };

type Scenario = {
  name: string;
  shapes: Shape[];
  joins: [string, string][];
  /** shapes with an arrow that leaves them and ends on nothing */
  dangles?: string[];
  frames?: Frame[];
  /** what the arrange names: shapes, frames, or nothing for the whole scene */
  arranges: "everything" | string[];
};

type Scene = ReadonlyMap<string, ExcalidrawElement>;

/** the gap between ranks at the default grid size */
const RANK_GAP = 60;
const SLACK = 0.5;

const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
const GLYPH = 10;

const SCENARIOS: Scenario[] = [
  {
    name: "three boxes nobody joined, far apart",
    shapes: [
      { id: "shape-id-the-lair", at: [0, 0], label: "Lair" },
      { id: "shape-id-the-den", at: [900, 40], label: "Den" },
      { id: "shape-id-the-vault", at: [300, 700], label: "Vault" },
    ],
    joins: [],
    arranges: ["shape-id-the-lair", "shape-id-the-den", "shape-id-the-vault"],
  },
  {
    name: "a chain of four, scattered",
    shapes: [
      { id: "shape-id-alpha", at: [500, 0], label: "Alpha" },
      { id: "shape-id-bravo", at: [0, 400], label: "Bravo" },
      { id: "shape-id-charlie", at: [700, 300], label: "Charlie" },
      { id: "shape-id-delta", at: [100, 50], label: "Delta" },
    ],
    joins: [
      ["shape-id-alpha", "shape-id-bravo"],
      ["shape-id-bravo", "shape-id-charlie"],
      ["shape-id-charlie", "shape-id-delta"],
    ],
    arranges: [
      "shape-id-alpha",
      "shape-id-bravo",
      "shape-id-charlie",
      "shape-id-delta",
    ],
  },
  {
    name: "a tree of seven",
    shapes: [
      { id: "shape-id-root", at: [300, 600], label: "Root" },
      { id: "shape-id-left", at: [0, 0], label: "Left" },
      { id: "shape-id-right", at: [800, 100], label: "Right" },
      { id: "shape-id-left-a", at: [200, 300], label: "Left A" },
      { id: "shape-id-left-b", at: [600, 800], label: "Left B" },
      { id: "shape-id-right-a", at: [1000, 500], label: "Right A" },
      { id: "shape-id-right-b", at: [50, 900], label: "Right B" },
    ],
    joins: [
      ["shape-id-root", "shape-id-left"],
      ["shape-id-root", "shape-id-right"],
      ["shape-id-left", "shape-id-left-a"],
      ["shape-id-left", "shape-id-left-b"],
      ["shape-id-right", "shape-id-right-a"],
      ["shape-id-right", "shape-id-right-b"],
    ],
    arranges: [
      "shape-id-root",
      "shape-id-left",
      "shape-id-right",
      "shape-id-left-a",
      "shape-id-left-b",
      "shape-id-right-a",
      "shape-id-right-b",
    ],
  },
  {
    name: "a dense graph of six",
    shapes: [
      { id: "shape-id-one", at: [0, 0], label: "One" },
      { id: "shape-id-two", at: [400, 0], label: "Two" },
      { id: "shape-id-three", at: [800, 0], label: "Three" },
      { id: "shape-id-four", at: [0, 300], label: "Four" },
      { id: "shape-id-five", at: [400, 300], label: "Five" },
      { id: "shape-id-six", at: [800, 300], label: "Six" },
    ],
    joins: [
      ["shape-id-one", "shape-id-two"],
      ["shape-id-one", "shape-id-three"],
      ["shape-id-one", "shape-id-four"],
      ["shape-id-one", "shape-id-six"],
      ["shape-id-two", "shape-id-five"],
      ["shape-id-two", "shape-id-six"],
      ["shape-id-three", "shape-id-four"],
      ["shape-id-three", "shape-id-five"],
      ["shape-id-four", "shape-id-six"],
      ["shape-id-five", "shape-id-six"],
    ],
    arranges: [
      "shape-id-one",
      "shape-id-two",
      "shape-id-three",
      "shape-id-four",
      "shape-id-five",
      "shape-id-six",
    ],
  },
  {
    name: "a chain of three inside a frame that holds them",
    frames: [{ id: "frame-id-workshop", at: [0, 0], size: [520, 420] }],
    shapes: [
      {
        id: "shape-id-anvil",
        at: [40, 40],
        label: "Anvil",
        frame: "frame-id-workshop",
      },
      {
        id: "shape-id-bellows",
        at: [320, 60],
        label: "Bellows",
        frame: "frame-id-workshop",
      },
      {
        id: "shape-id-chisel",
        at: [60, 300],
        label: "Chisel",
        frame: "frame-id-workshop",
      },
    ],
    joins: [
      ["shape-id-anvil", "shape-id-bellows"],
      ["shape-id-bellows", "shape-id-chisel"],
    ],
    arranges: ["shape-id-anvil", "shape-id-bellows", "shape-id-chisel"],
  },
  {
    name: "a chain of three inside a frame, arranged by naming the frame",
    frames: [{ id: "frame-id-workshop", at: [0, 0], size: [520, 420] }],
    shapes: [
      {
        id: "shape-id-anvil",
        at: [40, 40],
        label: "Anvil",
        frame: "frame-id-workshop",
      },
      {
        id: "shape-id-bellows",
        at: [320, 60],
        label: "Bellows",
        frame: "frame-id-workshop",
      },
      {
        id: "shape-id-chisel",
        at: [60, 300],
        label: "Chisel",
        frame: "frame-id-workshop",
      },
    ],
    joins: [
      ["shape-id-anvil", "shape-id-bellows"],
      ["shape-id-bellows", "shape-id-chisel"],
    ],
    arranges: ["frame-id-workshop"],
  },
  {
    name: "two frames side by side, each holding a pair, arranged without naming anything",
    frames: [
      { id: "frame-id-north", at: [0, 0], size: [520, 300] },
      { id: "frame-id-south", at: [700, 0], size: [520, 300] },
    ],
    shapes: [
      {
        id: "shape-id-north-gate",
        at: [40, 40],
        label: "Gate",
        frame: "frame-id-north",
      },
      {
        id: "shape-id-north-keep",
        at: [320, 180],
        label: "Keep",
        frame: "frame-id-north",
      },
      {
        id: "shape-id-south-gate",
        at: [740, 40],
        label: "Gate",
        frame: "frame-id-south",
      },
      {
        id: "shape-id-south-keep",
        at: [1020, 180],
        label: "Keep",
        frame: "frame-id-south",
      },
    ],
    joins: [
      ["shape-id-north-gate", "shape-id-north-keep"],
      ["shape-id-south-gate", "shape-id-south-keep"],
    ],
    arranges: "everything",
  },
  {
    name: "a rectangle, an ellipse, a diamond and a sticky note, labelled and joined",
    shapes: [
      {
        id: "shape-id-gateway",
        at: [600, 500],
        size: [200, 80],
        label: "API gateway",
      },
      {
        id: "shape-id-auth",
        type: "ellipse",
        at: [0, 0],
        size: [160, 100],
        label: "Auth",
      },
      {
        id: "shape-id-valid",
        type: "diamond",
        at: [900, 100],
        size: [160, 120],
        label: "Valid?",
      },
      {
        id: "shape-id-memo",
        type: "stickynote",
        at: [200, 700],
        size: [250, 250],
        label: "Mind the cache",
      },
    ],
    joins: [
      ["shape-id-gateway", "shape-id-auth"],
      ["shape-id-gateway", "shape-id-valid"],
      ["shape-id-valid", "shape-id-memo"],
    ],
    arranges: [
      "shape-id-gateway",
      "shape-id-auth",
      "shape-id-valid",
      "shape-id-memo",
    ],
  },
];

const DANGLING: Scenario = {
  name: "a chain of three with an arrow left dangling from the middle",
  shapes: [
    { id: "shape-id-alpha", at: [500, 0], label: "Alpha" },
    { id: "shape-id-bravo", at: [0, 400], label: "Bravo" },
    { id: "shape-id-charlie", at: [700, 300], label: "Charlie" },
  ],
  joins: [
    ["shape-id-alpha", "shape-id-bravo"],
    ["shape-id-bravo", "shape-id-charlie"],
  ],
  dangles: ["shape-id-bravo"],
  arranges: ["shape-id-alpha", "shape-id-bravo", "shape-id-charlie"],
};

const CRAMPED: Scenario = {
  name: "a tree of four in a frame too narrow for it, 40px from another frame",
  frames: [
    { id: "frame-id-pantry", at: [0, 0], size: [400, 400] },
    { id: "frame-id-cellar", at: [440, 0], size: [300, 300] },
  ],
  shapes: [
    {
      id: "shape-id-shelf",
      at: [40, 40],
      label: "Shelf",
      frame: "frame-id-pantry",
    },
    {
      id: "shape-id-jam",
      at: [200, 160],
      label: "Jam",
      frame: "frame-id-pantry",
    },
    {
      id: "shape-id-tea",
      at: [40, 280],
      label: "Tea",
      frame: "frame-id-pantry",
    },
    {
      id: "shape-id-oats",
      at: [200, 300],
      label: "Oats",
      frame: "frame-id-pantry",
    },
  ],
  joins: [
    ["shape-id-shelf", "shape-id-jam"],
    ["shape-id-shelf", "shape-id-tea"],
    ["shape-id-shelf", "shape-id-oats"],
  ],
  arranges: ["frame-id-pantry"],
};

const scenarioNamed = (name: string) =>
  SCENARIOS.find((scenario) => scenario.name === name)!;

const arrowIdOf = (from: string, to: string) => `arrow-id-${from}-to-${to}`;

const danglingIdOf = (from: string) => `arrow-id-${from}-to-nowhere`;

const bindingTo = (elementId: string): FixedPointBinding => ({
  elementId,
  fixedPoint: [0.5, 0.5],
  mode: "orbit",
});

/** a board as a person draws it: labels measured and centred, arrows bound at both ends */
const sceneOf = ({ shapes, joins, dangles = [], frames = [] }: Scenario) => {
  const boxOf = (id: string) => {
    const shape = shapes.find((shape) => shape.id === id)!;
    const [width, height] = shape.size ?? [160, 80];
    return { x: shape.at[0], y: shape.at[1], width, height };
  };
  const frameOf = (id: string) =>
    shapes.find((shape) => shape.id === id)?.frame ?? null;

  return [
    ...frames.map(({ id, at, size }) => frame(id, ...at, ...size)),
    ...shapes.flatMap((shape) => {
      const box = boxOf(shape.id);
      const labelId = `${shape.id}-text`;
      const container = API.createElement({
        type: shape.type ?? "rectangle",
        id: shape.id,
        ...box,
        ...(shape.type === "stickynote" ? { baseHeight: box.height } : {}),
        frameId: shape.frame ?? null,
        strokeWidth: 2,
        boundElements: [
          { id: labelId, type: "text" },
          ...joins
            .filter(([from, to]) => from === shape.id || to === shape.id)
            .map(([from, to]) => ({
              id: arrowIdOf(from, to),
              type: "arrow" as const,
            })),
          ...dangles
            .filter((from) => from === shape.id)
            .map((from) => ({
              id: danglingIdOf(from),
              type: "arrow" as const,
            })),
        ],
      });
      const width = shape.label.length * GLYPH;
      const height = FONT_SIZE * LINE_HEIGHT;
      const label = API.createElement({
        type: "text",
        id: labelId,
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
        text: shape.label,
        fontSize: FONT_SIZE,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: shape.id,
        frameId: shape.frame ?? null,
      });
      return [container, label];
    }),
    ...joins.map(([from, to]) => {
      const start = boxOf(from);
      const end = boxOf(to);
      const x = start.x + start.width / 2;
      const y = start.y + start.height;
      const dx = end.x + end.width / 2 - x;
      const dy = end.y - y;
      return API.createElement({
        type: "arrow",
        id: arrowIdOf(from, to),
        x,
        y,
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(dx, dy)],
        startBinding: bindingTo(from),
        endBinding: bindingTo(to),
        endArrowhead: "arrow",
        frameId: frameOf(from) === frameOf(to) ? frameOf(from) : null,
      });
    }),
    ...dangles.map((from) => {
      const start = boxOf(from);
      return API.createElement({
        type: "arrow",
        id: danglingIdOf(from),
        x: start.x + start.width,
        y: start.y + start.height / 2,
        width: 200,
        height: 120,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 120)],
        startBinding: bindingTo(from),
        endArrowhead: "arrow",
      });
    }),
  ];
};

/** the shapes an arrange of this scenario should move, with frames resolved to what they hold */
const shapesOf = (scenario: Scenario) =>
  scenario.arranges === "everything"
    ? scenario.shapes.map((shape) => shape.id)
    : scenario.arranges.flatMap((id) => {
        const held = scenario.shapes.filter((shape) => shape.frame === id);
        return held.length ? held.map((shape) => shape.id) : [id];
      });

const requestOf = (scenario: Scenario) =>
  scenario.arranges === "everything" ? undefined : scenario.arranges;

const load = async (scenario?: Scenario) => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);
  if (scenario) {
    API.updateScene({
      elements: sceneOf(scenario),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
};

const snapshot = (): Scene =>
  new Map(h.elements.map((element) => [element.id, { ...element }]));

const geometryOf = (scene: Scene) =>
  [...scene.values()].map(({ id, x, y, width, height }) => ({
    id,
    x,
    y,
    width,
    height,
  }));

const boxIn = (scene: Scene, id: string) => {
  const { x, y, width, height } = scene.get(id)!;
  return { x, y, width, height };
};

const pressArrange = (
  init: KeyboardEventInit = {},
  target: Document | HTMLElement = document,
) =>
  fireEvent.keyDown(target, {
    key: "A",
    code: "KeyA",
    shiftKey: true,
    altKey: true,
    ...init,
  });

const watchArrange = () =>
  vi.spyOn(h.app.actionManager.actions.arrangeElements, "perform");

const select = (ids: readonly string[] | undefined) => {
  if (!ids) {
    API.clearSelection();
    return;
  }
  API.setSelectedElements(
    h.app.scene
      .getNonDeletedElements()
      .filter((element) => ids.includes(element.id)),
  );
};

type Trigger = "keyboard" | "api";

const TRIGGERS: Trigger[] = ["keyboard", "api"];

const arrangeBy: Record<
  Trigger,
  (ids: readonly string[] | undefined) => Promise<void>
> = {
  keyboard: async (ids) => {
    select(ids);
    const perform = watchArrange();
    await act(async () => {
      pressArrange();
      await perform.mock.results[0]?.value;
    });
    expect(perform).toHaveBeenCalledTimes(1);
    perform.mockRestore();
  },
  api: async (ids) => {
    await act(async () => {
      await h.app.api.arrange(ids ? { elementIds: ids } : undefined);
    });
  },
};

type Extent = { left: number; top: number; right: number; bottom: number };

/** where an element paints, taking a linear element's points into account */
const extentOf = (element: ExcalidrawElement): Extent => {
  if (!("points" in element)) {
    return {
      left: element.x,
      top: element.y,
      right: element.x + element.width,
      bottom: element.y + element.height,
    };
  }
  const xs = element.points.map(([x]) => element.x + x);
  const ys = element.points.map(([, y]) => element.y + y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
};

const pick = (scene: Scene, ids: readonly string[]) =>
  ids.flatMap((id) => scene.get(id) ?? []);

const live = (scene: Scene) =>
  [...scene.values()].filter((element) => !element.isDeleted);

/** positive: how far apart two shapes are along the axis that separates them; negative: they overlap */
const separation = (a: ExcalidrawElement, b: ExcalidrawElement) => {
  const p = extentOf(a);
  const q = extentOf(b);
  return Math.max(
    q.left - p.right,
    p.left - q.right,
    q.top - p.bottom,
    p.top - q.bottom,
  );
};

const moved = (before: Scene, after: Scene, ids: readonly string[]) =>
  ids.filter((id) => {
    const was = before.get(id);
    const now = after.get(id);
    return was && now && (was.x !== now.x || was.y !== now.y);
  });

const overlaps = (after: Scene, ids: readonly string[]) => {
  const shapes = pick(after, ids);
  return shapes.flatMap((a, i) =>
    shapes
      .slice(i + 1)
      .filter((b) => separation(a, b) < 0)
      .map((b) => `${a.id} overlaps ${b.id}`),
  );
};

const stranded = (after: Scene, ids: readonly string[]) => {
  const shapes = pick(after, ids);
  return shapes.flatMap((a) => {
    const nearest = Math.min(
      ...shapes.filter((b) => b !== a).map((b) => separation(a, b)),
    );
    return nearest > RANK_GAP + SLACK
      ? [`${a.id} is ${nearest}px from the nearest shape`]
      : [];
  });
};

/** each gap wider than the rank gap between consecutive bands of shapes down the page */
const wideRanks = (after: Scene, ids: readonly string[]) => {
  const spans = pick(after, ids)
    .map(extentOf)
    .map(({ top, bottom }) => [top, bottom] as const)
    .sort(([a], [b]) => a - b);
  const bands = spans.reduce<[number, number][]>((merged, [top, bottom]) => {
    const last = merged.at(-1);
    if (last && top <= last[1]) {
      last[1] = Math.max(last[1], bottom);
      return merged;
    }
    return [...merged, [top, bottom]];
  }, []);
  return bands
    .slice(1)
    .map(([top], i) => top - bands[i][1])
    .filter((gap) => gap > RANK_GAP + SLACK)
    .map((gap) => `${gap}px between ranks`);
};

const inside = (inner: Extent, outer: Extent) =>
  inner.left >= outer.left - SLACK &&
  inner.top >= outer.top - SLACK &&
  inner.right <= outer.right + SLACK &&
  inner.bottom <= outer.bottom + SLACK;

/** each element that names a frame but paints outside it, where the frame clips it away */
const escaped = (after: Scene) =>
  live(after).flatMap((element) => {
    const frame = element.frameId ? after.get(element.frameId) : undefined;
    if (!frame) {
      return [];
    }
    return inside(extentOf(element), extentOf(frame))
      ? []
      : [`${element.id} spills out of ${frame.id}`];
  });

/** each frame that moved or got smaller */
const shrunk = (before: Scene, after: Scene, scenario: Scenario) =>
  (scenario.frames ?? []).flatMap(({ id }) => {
    const was = before.get(id)!;
    const now = after.get(id)!;
    return now.x === was.x &&
      now.y === was.y &&
      now.width >= was.width &&
      now.height >= was.height
      ? []
      : [
          `${id} went from ${was.width}x${was.height} at ${was.x},${was.y} to ${now.width}x${now.height} at ${now.x},${now.y}`,
        ];
  });

/** each arrow that lost a binding or no longer ends at the outline of the shapes it joins */
const unbound = (after: Scene, scenario: Scenario) => {
  const elementsMap = new Map(after);
  return scenario.joins.flatMap(([from, to]) => {
    const id = arrowIdOf(from, to);
    const arrow = after.get(id);
    if (!arrow || !isArrowElement(arrow) || arrow.isDeleted) {
      return [`${id} is gone`];
    }
    if (
      arrow.startBinding?.elementId !== from ||
      arrow.endBinding?.elementId !== to
    ) {
      return [`${id} is no longer bound from ${from} to ${to}`];
    }
    const tips = [
      { end: from, point: arrow.points[0] },
      { end: to, point: arrow.points[arrow.points.length - 1] },
    ];
    return tips.flatMap(({ end, point }) => {
      const shape = after.get(end)!;
      const tip = pointFrom<GlobalPoint>(
        arrow.x + point[0],
        arrow.y + point[1],
      );
      const distance = distanceToElement(shape, elementsMap, tip);
      // the fork leaves the binding gap between a bound tip and the outline
      return distance > getBindingGap(shape) + 1
        ? [`${id} ends ${distance}px from ${end}'s outline`]
        : [];
    });
  });
};

const labelsOf = (scene: Scene) =>
  live(scene).filter(
    (element) => element.type === "text" && element.containerId,
  );

/** each label whose text or measured size changed, though only its shape moved */
const remeasured = (before: Scene, after: Scene) =>
  labelsOf(before).flatMap((was) => {
    const now = after.get(was.id);
    if (!now || now.type !== "text" || was.type !== "text") {
      return [`${was.id} is gone`];
    }
    const changed = (["text", "width", "height", "fontSize"] as const).filter(
      (key) => was[key] !== now[key],
    );
    return changed.length
      ? [
          `${was.id} changed ${changed
            .map((key) => `${key} ${String(was[key])} -> ${String(now[key])}`)
            .join(", ")}`,
        ]
      : [];
  });

/** each label that is not where Excalidraw lays a label out in its shape */
const misplaced = (after: Scene) => {
  const elementsMap = new Map(after);
  return labelsOf(after).flatMap((label) => {
    if (!isBoundToContainer(label)) {
      return [];
    }
    const { x, y } = computeBoundTextPosition(
      after.get(label.containerId)!,
      label,
      elementsMap,
    );
    return Math.abs(label.x - x) > 0.01 || Math.abs(label.y - y) > 0.01
      ? [`${label.id} sits at ${label.x},${label.y}, not ${x},${y}`]
      : [];
  });
};

/** each label that paints outside its shape */
const spilled = (after: Scene) =>
  labelsOf(after).flatMap((label) => {
    const shape =
      label.type === "text" && label.containerId
        ? after.get(label.containerId)
        : undefined;
    if (!shape) {
      return [`${label.id} lost its shape`];
    }
    return inside(extentOf(label), extentOf(shape))
      ? []
      : [`${label.id} spills out of ${shape.id}`];
  });

describe.each(
  SCENARIOS.flatMap((scenario) =>
    TRIGGERS.map((trigger) => ({ ...scenario, trigger })),
  ),
)("arranging $name by $trigger", (scenario) => {
  const ids = shapesOf(scenario);
  let before: Scene;
  let after: Scene;

  beforeEach(async () => {
    await load(scenario);
    before = snapshot();
    await arrangeBy[scenario.trigger](requestOf(scenario));
    after = snapshot();
  });

  it("should move at least one shape", () => {
    expect(moved(before, after, ids)).not.toEqual([]);
  });

  it("should overlap no two shapes", () => {
    expect(overlaps(after, ids)).toEqual([]);
  });

  it("should leave every shape within the rank gap of its nearest neighbour", () => {
    expect(stranded(after, ids)).toEqual([]);
  });

  it("should leave no more than the rank gap between ranks", () => {
    expect(wideRanks(after, ids)).toEqual([]);
  });

  it("should keep everything in a frame inside that frame", () => {
    expect(escaped(after)).toEqual([]);
  });

  it("should only ever grow a frame, in place", () => {
    expect(shrunk(before, after, scenario)).toEqual([]);
  });

  it("should keep every arrow bound, ending on the shapes it joins", () => {
    expect(unbound(after, scenario)).toEqual([]);
  });

  it("should keep each label as it was measured", () => {
    expect(remeasured(before, after)).toEqual([]);
  });

  it("should keep each label inside its shape", () => {
    expect(spilled(after)).toEqual([]);
  });

  it("should lay each label out in its shape as Excalidraw does", () => {
    expect(misplaced(after)).toEqual([]);
  });
});

describe.each(TRIGGERS)("undoing an arrange made by %s", (trigger) => {
  const scenario = scenarioNamed(
    "a chain of three inside a frame that holds them",
  );
  let before: Scene;
  let undoDepth: number;

  beforeEach(async () => {
    await load(scenario);
    before = snapshot();
    undoDepth = API.getUndoStack().length;
    await arrangeBy[trigger](requestOf(scenario));
  });

  it("should add one undo step", () => {
    expect(API.getUndoStack().length).toBe(undoDepth + 1);
  });

  it("should put every shape back and the frame back to its size in that one step", () => {
    Keyboard.undo();
    expect(geometryOf(snapshot())).toEqual(geometryOf(before));
  });
});

describe.each(SCENARIOS)("arranging $name a second time", (scenario) => {
  let first: Scene;
  let second: Scene;

  beforeEach(async () => {
    await load(scenario);
    await arrangeBy.api(requestOf(scenario));
    first = snapshot();
    await arrangeBy.api(requestOf(scenario));
    second = snapshot();
  });

  it("should move nothing", () => {
    expect(geometryOf(second)).toEqual(geometryOf(first));
  });
});

describe("when a target changes while the layout runs", () => {
  const scenario = scenarioNamed("a chain of four, scattered");
  const ids = shapesOf(scenario);

  const nudge = () => {
    const target = h.app.scene.getNonDeletedElementsMap().get(ids[0])!;
    h.app.scene.mutateElement(target, { x: target.x + 1 });
  };

  beforeEach(async () => {
    await load(scenario);
  });

  it("should refuse to apply a plan made before the change", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: LayoutEngine = async (graph) => {
      await gate;
      return new Map(
        graph.nodes.map((node, i): [string, { x: number; y: number }] => [
          node.id,
          { x: i * 400, y: 0 },
        ]),
      );
    };

    const planning = planArrange(
      h.app.scene,
      h.state,
      { elementIds: ids },
      engine,
    );
    nudge();
    const nudged = snapshot();
    release();
    const plan = await planning;

    expect(applyArrangePlan(h.app.scene, plan!)).toBe("stale");
    expect(geometryOf(snapshot())).toEqual(geometryOf(nudged));
  });

  it("should report stale from the API and move nothing", async () => {
    let outcome: ArrangeOutcome | undefined;
    let nudged: Scene | undefined;
    await act(async () => {
      const arranging = h.app.api.arrange({ elementIds: ids });
      nudge();
      nudged = snapshot();
      outcome = await arranging;
    });

    expect(outcome).toEqual({ status: "stale" });
    expect(geometryOf(snapshot())).toEqual(geometryOf(nudged!));
  });

  it("should ask to try again from the keyboard, move nothing and add no undo step", async () => {
    select(ids);
    const undoDepth = API.getUndoStack().length;
    const perform = watchArrange();
    let nudged: Scene | undefined;
    await act(async () => {
      pressArrange();
      nudge();
      nudged = snapshot();
      await perform.mock.results[0]?.value;
    });

    expect(h.state.toast?.message).toMatch(/try again/i);
    expect(geometryOf(snapshot())).toEqual(geometryOf(nudged!));
    expect(API.getUndoStack().length).toBe(undoDepth);
  });
});

describe.each<[string, KeyboardEventInit]>([
  ["held down so it repeats", { repeat: true }],
  ["with Ctrl", { ctrlKey: true }],
  ["with Cmd", { metaKey: true }],
  ["without Shift", { shiftKey: false }],
])("pressing Shift+Alt+A %s", (_, init) => {
  const scenario = scenarioNamed("a chain of four, scattered");

  beforeEach(async () => {
    await load(scenario);
    select(shapesOf(scenario));
  });

  it("should not arrange", () => {
    const perform = watchArrange();
    pressArrange(init);
    expect(perform).not.toHaveBeenCalled();
  });
});

describe("pressing Shift+Alt+A while typing a label", () => {
  const scenario = scenarioNamed("a chain of four, scattered");

  beforeEach(async () => {
    await load(scenario);
    select(["shape-id-alpha"]);
  });

  it("should leave the keys to the text", async () => {
    Keyboard.keyPress(KEYS.ENTER);
    const editor = await getTextEditor();
    const perform = watchArrange();
    pressArrange({}, editor);
    expect(perform).not.toHaveBeenCalled();
  });
});

describe.each(["mrtree", "rectpacking"] as const)(
  "arranging the tree of seven with %s",
  (algorithm) => {
    const scenario = scenarioNamed("a tree of seven");
    const ids = shapesOf(scenario);
    let before: Scene;
    let after: Scene;

    beforeEach(async () => {
      await load(scenario);
      before = snapshot();
      await act(async () => {
        await h.app.api.arrange({ elementIds: ids, algorithm });
      });
      after = snapshot();
    });

    it("should move at least one shape", () => {
      expect(moved(before, after, ids)).not.toEqual([]);
    });

    it("should overlap no two shapes", () => {
      expect(overlaps(after, ids)).toEqual([]);
    });
  },
);

describe("arranging an empty scene", () => {
  beforeEach(async () => {
    await load();
  });

  it("should report nothing to arrange", async () => {
    let outcome: ArrangeOutcome | undefined;
    await act(async () => {
      outcome = await h.app.api.arrange();
    });
    expect(outcome).toEqual({ status: "nothing-to-arrange", skipped: [] });
  });
});

describe("arranging with the pointer alone", () => {
  const scenario = scenarioNamed("a chain of four, scattered");
  const ids = shapesOf(scenario);
  let before: Scene;

  const arrangeByClicking = async (click: () => void) => {
    const perform = watchArrange();
    await act(async () => {
      click();
      await perform.mock.results[0]?.value;
    });
    expect(perform).toHaveBeenCalledTimes(1);
  };

  beforeEach(async () => {
    await load(scenario);
    before = snapshot();
    mouse.select(pick(before, ids));
  });

  it("should arrange the picked shapes from the Auto-arrange button", async () => {
    await arrangeByClicking(() => UI.clickLabeledElement("Auto-arrange"));

    const after = snapshot();
    expect(moved(before, after, ids)).not.toEqual([]);
    expect(overlaps(after, ids)).toEqual([]);
  });

  it("should arrange the picked shapes from a shape's context menu", async () => {
    const alpha = before.get("shape-id-alpha")!;
    mouse.rightClickAt(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2);
    const item = queryByTestId(UI.queryContextMenu()!, "arrangeElements");
    await arrangeByClicking(() =>
      fireEvent.click(item!.querySelector("button")!),
    );

    const after = snapshot();
    expect(moved(before, after, ids)).not.toEqual([]);
    expect(overlaps(after, ids)).toEqual([]);
  });
});

describe("arranging a single shape", () => {
  const scenario = scenarioNamed("a chain of four, scattered");

  beforeEach(async () => {
    await load(scenario);
  });

  it("should report nothing to arrange from the API", async () => {
    let outcome: ArrangeOutcome | undefined;
    await act(async () => {
      outcome = await h.app.api.arrange({ elementIds: ["shape-id-alpha"] });
    });
    expect(outcome).toEqual({ status: "nothing-to-arrange", skipped: [] });
  });

  it("should say why nothing was arranged from the keyboard", async () => {
    const before = snapshot();
    await arrangeBy.keyboard(["shape-id-alpha"]);

    expect(h.state.toast?.message).toMatch(/nothing to arrange/i);
    expect(geometryOf(snapshot())).toEqual(geometryOf(before));
  });
});

describe("arranging standalone text and a pen stroke", () => {
  const note = API.createElement({
    type: "text",
    id: "text-id-note",
    x: 0,
    y: 0,
  });
  const stroke = API.createElement({
    type: "freedraw",
    id: "freedraw-id-stroke",
    x: 400,
    y: 300,
  });

  beforeEach(async () => {
    await load();
    API.updateScene({
      elements: [note, stroke],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });

  it("should leave them where they are and name them from the API", async () => {
    const before = snapshot();
    let outcome: ArrangeOutcome | undefined;
    await act(async () => {
      outcome = await h.app.api.arrange();
    });

    expect(outcome).toEqual({
      status: "nothing-to-arrange",
      skipped: ["freedraw", "text"],
    });
    expect(geometryOf(snapshot())).toEqual(geometryOf(before));
  });

  it("should say from the keyboard that only shapes are arranged", async () => {
    await arrangeBy.keyboard([note.id, stroke.id]);

    expect(h.state.toast?.message).toMatch(/only shapes are arranged/i);
    expect(h.state.toast?.message).toMatch(/freedraw, text/);
  });
});

describe.each(TRIGGERS)(
  "arranging shapes with an arrow bound at one end by %s",
  (trigger) => {
    const id = danglingIdOf("shape-id-bravo");
    let before: Scene;
    let after: Scene;

    const freeEnd = (scene: Scene) => {
      const arrow = scene.get(id)!;
      if (!isArrowElement(arrow)) {
        throw new Error(`${id} is not an arrow`);
      }
      const [x, y] = arrow.points[arrow.points.length - 1];
      return { x: arrow.x + x, y: arrow.y + y };
    };

    beforeEach(async () => {
      await load(DANGLING);
      before = snapshot();
      await arrangeBy[trigger](requestOf(DANGLING));
      after = snapshot();
    });

    it("should move the shape the arrow leaves", () => {
      expect(moved(before, after, ["shape-id-bravo"])).toEqual([
        "shape-id-bravo",
      ]);
    });

    it("should keep the arrow bound at its start, on the shape's outline", () => {
      const arrow = after.get(id)!;
      const bravo = after.get("shape-id-bravo")!;
      if (!isArrowElement(arrow)) {
        throw new Error(`${id} is not an arrow`);
      }
      const [x, y] = arrow.points[0];
      const tip = pointFrom<GlobalPoint>(arrow.x + x, arrow.y + y);

      expect(arrow.startBinding?.elementId).toBe("shape-id-bravo");
      expect(arrow.endBinding).toBe(null);
      expect(distanceToElement(bravo, new Map(after), tip)).toBeLessThanOrEqual(
        getBindingGap(bravo) + 1,
      );
    });

    it("should leave the arrow's free end where it was", () => {
      expect(freeEnd(after)).toEqual(freeEnd(before));
    });
  },
);

describe("growing a frame into the frame beside it", () => {
  const ids = shapesOf(CRAMPED);
  let before: Scene;

  beforeEach(async () => {
    await load(CRAMPED);
    before = snapshot();
  });

  it("should report the frame it now overlaps and leave that frame where it was", async () => {
    let outcome: ArrangeOutcome | undefined;
    await act(async () => {
      outcome = await h.app.api.arrange({ elementIds: requestOf(CRAMPED) });
    });
    const after = snapshot();

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "arranged",
        overlappedFrameIds: ["frame-id-cellar"],
      }),
    );
    expect(after.get("frame-id-pantry")!.width).toBeGreaterThan(
      before.get("frame-id-pantry")!.width,
    );
    expect(boxIn(after, "frame-id-cellar")).toEqual(
      boxIn(before, "frame-id-cellar"),
    );
    expect(overlaps(after, ids)).toEqual([]);
  });

  it("should warn from the keyboard that the frame now overlaps its neighbour", async () => {
    await arrangeBy.keyboard(requestOf(CRAMPED));

    expect(h.state.toast?.message).toMatch(/overlaps frame-id-cellar/);
  });
});
