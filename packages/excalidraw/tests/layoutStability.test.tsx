import fs from "node:fs";
import path from "node:path";

import React from "react";

import { pointFrom } from "@excalidraw/math";
import {
  CaptureUpdateAction,
  applyArrangePlan,
  commonShift,
  displacement,
  edgeCrossings,
  orderInversions,
  planArrange,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ArrangeRequest,
  LayoutEngine,
  PlacedBox,
  Placement,
} from "@excalidraw/element";
import type { FixedPointBinding } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { elkLayout } from "../arrange/elkLayout";

import { API } from "./helpers/api";
import { frame } from "./helpers/frames";
import { act, render } from "./test-utils";

const { h } = window;

const FRAME = "frame-id-tidy";
const NODE_SPACING = 40;
const HEIGHT = 70;
const LAYER_TOLERANCE = HEIGHT / 2;

type Edge = { source: string; target: string };

const NAMES: Record<string, string> = {
  gateway: "Gateway",
  auth: "Auth",
  api: "API",
  web: "Web",
  users: "Users",
  sessions: "Sessions",
  orders: "Orders",
  catalog: "Catalog",
  search: "Search",
  assets: "Assets",
  usersDb: "Users DB",
  cache: "Cache",
  ordersDb: "Orders DB",
  payments: "Payments",
  index: "Index",
  cdn: "CDN",
  stripe: "Stripe",
  ledger: "Ledger",
  backup: "Backup",
  metrics: "Metrics",
  notify: "Notify",
  fraud: "Fraud",
  audit: "Audit",
};

const join = (pairs: string): Edge[] =>
  pairs
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [source, target] = pair.split(">");
      return { source, target };
    });

/** the tidy frame the human already has: 20 services, 25 calls */
const HUMAN_EDGES = join(`
  gateway>auth gateway>api gateway>web
  auth>users auth>sessions api>orders api>catalog api>search web>search web>assets
  users>usersDb sessions>cache catalog>cache orders>ordersDb orders>payments
  search>index catalog>index assets>cdn
  payments>stripe payments>ledger ordersDb>ledger usersDb>backup ordersDb>backup
  cache>metrics index>metrics
`);

const HUMAN_NODES = [
  ...new Set(HUMAN_EDGES.flatMap((e) => [e.source, e.target])),
];

/**
 * What an agent writes into the frame: a new leaf, a node spliced into an
 * existing chain, and a node with a long edge across the diagram.
 */
const AGENT_EDGES = join(
  `orders>notify payments>fraud fraud>stripe auth>audit audit>ledger`,
);
const AGENT_NODES = ["notify", "fraud", "audit"];

const widthOf = (id: string) => 120 + NAMES[id].length * 8;

/** where the agent puts a new node before any arrange runs */
type Drop = "beside" | "corner";

const dropAt = (
  drop: Drop,
  id: string,
  i: number,
  tidy: Placement,
  frameBox: PlacedBox,
) => {
  if (drop === "corner") {
    return { x: frameBox.x + 40, y: frameBox.y + 40 + i * (HEIGHT + 20) };
  }
  const parent = tidy.get(AGENT_EDGES.find((e) => e.target === id)!.source)!;
  return { x: parent.x + parent.width + 40, y: parent.y + HEIGHT + 60 };
};

const bindingTo = (elementId: string): FixedPointBinding => ({
  elementId,
  fixedPoint: [0.5, 0.5],
  mode: "orbit",
});

const arrowIdOf = ({ source, target }: Edge) => `arrow-${source}-${target}`;

const sceneOf = (
  at: ReadonlyMap<string, { x: number; y: number }>,
  edges: readonly Edge[],
  frameBox: PlacedBox,
) => [
  frame(FRAME, frameBox.x, frameBox.y, frameBox.width, frameBox.height),
  ...[...at].map(([id, { x, y }]) =>
    API.createElement({
      type: "rectangle",
      id,
      x,
      y,
      width: widthOf(id),
      height: HEIGHT,
      frameId: FRAME,
      boundElements: edges
        .filter((e) => e.source === id || e.target === id)
        .map((e) => ({ id: arrowIdOf(e), type: "arrow" as const })),
    }),
  ),
  ...edges.map((edge) => {
    const from = at.get(edge.source)!;
    const to = at.get(edge.target)!;
    return API.createElement({
      type: "arrow",
      id: arrowIdOf(edge),
      x: from.x,
      y: from.y,
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(to.x - from.x, to.y - from.y),
      ],
      startBinding: bindingTo(edge.source),
      endBinding: bindingTo(edge.target),
      frameId: FRAME,
    });
  }),
];

const placementOf = (ids: readonly string[]): Map<string, PlacedBox> => {
  const elements = h.app.scene.getNonDeletedElementsMap();
  return new Map(
    ids.map((id) => {
      const { x, y, width, height } = elements.get(id)!;
      return [id, { x, y, width, height }];
    }),
  );
};

const frameBox = (): PlacedBox => {
  const { x, y, width, height } = h.app.scene
    .getNonDeletedElementsMap()
    .get(FRAME)!;
  return { x, y, width, height };
};

const load = (
  at: ReadonlyMap<string, { x: number; y: number }>,
  edges: readonly Edge[],
  box: PlacedBox,
) =>
  API.updateScene({
    elements: sceneOf(at, edges, box),
    captureUpdate: CaptureUpdateAction.NEVER,
  });

let engineMs: number[] = [];
const timedElk: LayoutEngine = async (graph, options) => {
  const start = performance.now();
  const positions = await elkLayout(graph, options);
  engineMs.push(performance.now() - start);
  return positions;
};

const arrange = async (request: Omit<ArrangeRequest, "elementIds">) => {
  await act(async () => {
    const plan = await planArrange(
      h.app.scene,
      h.state,
      { elementIds: [FRAME], ...request },
      timedElk,
    );
    const applied = applyArrangePlan(h.app.scene, plan!);
    expect(applied).not.toBe("stale");
  });
};

type Variant = {
  name: string;
  request: Omit<ArrangeRequest, "elementIds">;
};

const VARIANTS: Variant[] = [
  { name: "fresh", request: { mode: "fresh" } },
  { name: "incremental", request: { mode: "incremental" } },
  {
    name: "order-only",
    request: {
      mode: "incremental",
      elkOptions: {
        "elk.layered.cycleBreaking.strategy": "GREEDY",
        "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      },
    },
  },
  {
    name: "semi",
    request: {
      mode: "incremental",
      elkOptions: {
        "elk.layered.cycleBreaking.strategy": "GREEDY",
        "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.crossingMinimization.semiInteractive": "true",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      },
    },
  },
];

/** a deterministic scatter, so the human's tidy layout is reproducible */
const scattered = () =>
  new Map(
    HUMAN_NODES.map((id, i) => [
      id,
      { x: 40 + ((i * 677) % 1500), y: 40 + ((i * 389) % 900) },
    ]),
  );

const tidyUp = async () => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);
  load(scattered(), HUMAN_EDGES, { x: 0, y: 0, width: 1700, height: 1100 });
  await arrange({ mode: "fresh" });
  return { tidy: placementOf(HUMAN_NODES), box: frameBox() };
};

const measure = (tidy: Placement, after: Placement, edges: readonly Edge[]) => {
  const moved = displacement(tidy, after, HUMAN_NODES);
  const aligned = displacement(
    tidy,
    after,
    HUMAN_NODES,
    commonShift(tidy, after, HUMAN_NODES),
  );
  const order = orderInversions(tidy, after, HUMAN_NODES, LAYER_TOLERANCE);
  return {
    meanSpacings: moved.mean / NODE_SPACING,
    maxSpacings: moved.max / NODE_SPACING,
    alignedMeanSpacings: aligned.mean / NODE_SPACING,
    alignedMaxSpacings: aligned.max / NODE_SPACING,
    movedOf20: aligned.moved,
    inLayerInversions: order.withinLayer,
    kendallTau: order.kendallTau,
    crossLayerFlips: order.acrossLayers,
    crossings: edgeCrossings(after, edges),
  };
};

const svgOf = (
  title: string,
  tidy: Placement,
  after: Placement,
  edges: readonly Edge[],
  box: PlacedBox,
) => {
  const all = [...after.values(), ...tidy.values(), box];
  const minX = Math.min(...all.map((b) => b.x)) - 40;
  const minY = Math.min(...all.map((b) => b.y)) - 80;
  const maxX = Math.max(...all.map((b) => b.x + b.width)) + 40;
  const maxY = Math.max(...all.map((b) => b.y + b.height)) + 40;
  const c = (b: PlacedBox) => [b.x + b.width / 2, b.y + b.height / 2];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${
      maxX - minX
    } ${maxY - minY}" width="${(maxX - minX) / 2}" height="${
      (maxY - minY) / 2
    }" font-family="sans-serif">`,
    `<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${
      maxY - minY
    }" fill="#fff"/>`,
    `<text x="${minX + 20}" y="${minY + 50}" font-size="34">${title}</text>`,
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#adb5bd" stroke-width="3"/>`,
    ...[...tidy].map(
      ([, b]) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="#adb5bd" stroke-dasharray="8 6" stroke-width="2"/>`,
    ),
    ...edges.map(({ source, target }) => {
      const [x1, y1] = c(after.get(source)!);
      const [x2, y2] = c(after.get(target)!);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#495057" stroke-width="3"/>`;
    }),
    ...[...after].map(([id, b]) => {
      const agent = AGENT_NODES.includes(id);
      return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${
        b.height
      }" rx="10" fill="${agent ? "#ffd8a8" : "#a5d8ff"}" stroke="${
        agent ? "#e8590c" : "#1971c2"
      }" stroke-width="3"/><text x="${b.x + b.width / 2}" y="${
        b.y + b.height / 2 + 9
      }" font-size="26" text-anchor="middle">${NAMES[id]}</text>`;
    }),
    ...[...tidy].map(([id, b]) => {
      const [x1, y1] = c(b);
      const [x2, y2] = c(after.get(id)!);
      return Math.hypot(x2 - x1, y2 - y1) < 1
        ? ""
        : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e03131" stroke-width="4"/><circle cx="${x1}" cy="${y1}" r="7" fill="#e03131"/>`;
    }),
    `</svg>`,
  ];
  return parts.join("\n");
};

const OUT = process.env.SPIKE_OUT;

describe("incremental arrange keeps a tidy frame's mental map", () => {
  beforeEach(() => {
    engineMs = [];
  });

  it("re-arranging a tidy frame with no additions moves nothing, in either mode", async () => {
    const { tidy, box } = await tidyUp();
    for (const mode of ["fresh", "incremental"] as const) {
      load(new Map([...tidy].map(([id, b]) => [id, b])), HUMAN_EDGES, box);
      await arrange({ mode });
      expect(
        displacement(tidy, placementOf(HUMAN_NODES), HUMAN_NODES).max,
      ).toBe(0);
    }
  });

  it("compares fresh and incremental after three agent additions", async () => {
    const { tidy, box } = await tidyUp();
    const edges = [...HUMAN_EDGES, ...AGENT_EDGES];
    const ids = [...HUMAN_NODES, ...AGENT_NODES];
    const rows: Record<string, unknown>[] = [
      {
        variant: "tidy (20 nodes, before)",
        crossings: edgeCrossings(tidy, HUMAN_EDGES),
      },
    ];
    const results = new Map<string, ReturnType<typeof measure>>();
    for (const drop of ["beside", "corner"] as const) {
      for (const variant of VARIANTS) {
        const at = new Map<string, { x: number; y: number }>(
          [...tidy].map(([id, b]) => [id, { x: b.x, y: b.y }]),
        );
        AGENT_NODES.forEach((id, i) =>
          at.set(id, dropAt(drop, id, i, tidy, box)),
        );
        load(at, edges, box);
        engineMs = [];
        await arrange(variant.request);
        const after = placementOf(ids);
        const metrics = measure(tidy, after, edges);
        results.set(`${drop} ${variant.name}`, metrics);
        rows.push({
          drop,
          variant: variant.name,
          ...Object.fromEntries(
            Object.entries(metrics).map(([k, v]) => [
              k,
              Math.round(v * 100) / 100,
            ]),
          ),
          elkMs: Math.round(engineMs[0]),
        });
        if (OUT) {
          fs.mkdirSync(OUT, { recursive: true });
          fs.writeFileSync(
            path.join(OUT, `${drop}-${variant.name}.svg`),
            svgOf(
              `${
                variant.name
              }, agent drops ${drop}: mean move ${metrics.meanSpacings.toFixed(
                1,
              )} spacings, ${metrics.inLayerInversions} inversions, ${
                metrics.crossings
              } crossings`,
              tidy,
              after,
              edges,
              box,
            ),
          );
        }
      }
    }
    if (OUT) {
      fs.writeFileSync(
        path.join(OUT, "results.json"),
        JSON.stringify(rows, null, 2),
      );
    }
    console.table(rows);

    const seeded = results.get("beside incremental")!;
    const seededFresh = results.get("beside fresh")!;
    expect(seeded.inLayerInversions).toBe(0);
    expect(seeded.crossLayerFlips).toBe(0);
    expect(seeded.movedOf20).toBeLessThanOrEqual(5);
    expect(seeded.alignedMeanSpacings).toBeLessThan(
      seededFresh.alignedMeanSpacings / 2,
    );
    expect(seeded.crossings).toBeLessThanOrEqual(seededFresh.crossings);

    const unseeded = results.get("corner incremental")!;
    expect(unseeded.crossings).toBeGreaterThan(
      2 * results.get("corner fresh")!.crossings,
    );
  });
});

describe("layout stability metrics", () => {
  const box = (x: number, y: number): PlacedBox => ({
    x,
    y,
    width: 10,
    height: 10,
  });

  it("counts a swapped pair in a layer as one inversion", () => {
    const before = new Map([
      ["a", box(0, 0)],
      ["b", box(50, 0)],
      ["c", box(100, 0)],
    ]);
    const after = new Map([
      ["a", box(50, 0)],
      ["b", box(0, 0)],
      ["c", box(100, 0)],
    ]);
    expect(orderInversions(before, after, ["a", "b", "c"], 5)).toEqual({
      withinLayer: 1,
      acrossLayers: 0,
      kendallTau: 1 / 3,
    });
  });

  it("counts a node that rose above its old upper layer as a flip", () => {
    const before = new Map([
      ["a", box(0, 0)],
      ["b", box(0, 100)],
    ]);
    const after = new Map([
      ["a", box(0, 100)],
      ["b", box(0, 0)],
    ]);
    expect(orderInversions(before, after, ["a", "b"], 5).acrossLayers).toBe(1);
  });

  it("counts an X as one crossing and edges meeting at a node as none", () => {
    const placement = new Map([
      ["a", box(0, 0)],
      ["b", box(100, 0)],
      ["c", box(0, 100)],
      ["d", box(100, 100)],
    ]);
    expect(
      edgeCrossings(placement, [
        { source: "a", target: "d" },
        { source: "b", target: "c" },
      ]),
    ).toBe(1);
    expect(
      edgeCrossings(placement, [
        { source: "a", target: "d" },
        { source: "a", target: "c" },
      ]),
    ).toBe(0);
  });

  it("ignores a slide of the whole drawing once the common shift is taken off", () => {
    const before = new Map([
      ["a", box(0, 0)],
      ["b", box(50, 0)],
      ["c", box(0, 50)],
    ]);
    const after = new Map([
      ["a", box(30, 40)],
      ["b", box(80, 40)],
      ["c", box(30, 190)],
    ]);
    const ids = ["a", "b", "c"];
    expect(displacement(before, after, ids).moved).toBe(3);
    expect(
      displacement(before, after, ids, commonShift(before, after, ids)),
    ).toEqual({ mean: 100 / 3, max: 100, moved: 1 });
  });
});
