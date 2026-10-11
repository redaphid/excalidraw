import { expect, test } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

const SCENE_KEY = "excalidraw-playground-scene";
/** only ELK's own code carries this: both its worker build and its main-thread bundle */
const ELK_MARK = "org.eclipse.elk";
/** the binding gap the editor leaves between a bound arrow tip and the shape, plus rounding */
const TIP_SLACK = 8;

type Point = { x: number; y: number };

type Element = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  points?: [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
};

type SavedScene = { elements: Element[] };

const SIZE = { width: 120, height: 60 };

const SHAPES = [
  { id: "shape-id-alpha", label: "Alpha", x: 220, y: 240 },
  { id: "shape-id-bravo", label: "Bravo", x: 40, y: 520 },
  { id: "shape-id-charlie", label: "Charlie", x: 240, y: 440 },
  { id: "shape-id-delta", label: "Delta", x: 60, y: 300 },
];

const JOINS = [
  ["shape-id-alpha", "shape-id-bravo"],
  ["shape-id-bravo", "shape-id-charlie"],
  ["shape-id-charlie", "shape-id-delta"],
] as const;

const arrowIdOf = (from: string, to: string) => `arrow-id-${from}-to-${to}`;

const centreOf = (id: string) => {
  const shape = SHAPES.find((shape) => shape.id === id)!;
  return { x: shape.x + SIZE.width / 2, y: shape.y + SIZE.height / 2 };
};

const binding = (elementId: string) => ({
  elementId,
  fixedPoint: [0.5, 0.5],
  mode: "orbit",
});

/** a scattered chain as a person leaves it: labelled boxes, arrows bound at both ends */
const SCENE = {
  elements: [
    ...SHAPES.flatMap(({ id, label, x, y }) => [
      {
        id,
        type: "rectangle",
        x,
        y,
        ...SIZE,
        strokeWidth: 2,
        boundElements: [
          { id: `${id}-text`, type: "text" },
          ...JOINS.filter((join) => join.includes(id)).map(([from, to]) => ({
            id: arrowIdOf(from, to),
            type: "arrow",
          })),
        ],
      },
      {
        id: `${id}-text`,
        type: "text",
        x: x + SIZE.width / 2 - label.length * 5,
        y: y + SIZE.height / 2 - 12.5,
        width: label.length * 10,
        height: 25,
        text: label,
        originalText: label,
        fontSize: 20,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: id,
      },
    ]),
    ...JOINS.map(([from, to]) => {
      const start = centreOf(from);
      const end = centreOf(to);
      return {
        id: arrowIdOf(from, to),
        type: "arrow",
        x: start.x,
        y: start.y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        points: [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ],
        startBinding: binding(from),
        endBinding: binding(to),
        startArrowhead: null,
        endArrowhead: "arrow",
      };
    }),
  ],
  appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 },
};

const savedScene = (page: Page): Promise<SavedScene | null> =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    SCENE_KEY,
  );

/** every script the page has loaded so far, and those of them that carry the mark */
const scriptsCarrying = (page: Page, mark: string) =>
  page.evaluate(async (mark) => {
    const loaded = [
      ...new Set([
        ...performance.getEntriesByType("resource").map(({ name }) => name),
        ...[...document.scripts].map(({ src }) => src),
      ]),
    ].filter((url) => /\.m?js(\?|$)/.test(url));
    const carrying: string[] = [];
    for (const url of loaded) {
      if ((await (await fetch(url)).text()).includes(mark)) {
        carrying.push(url);
      }
    }
    return { loaded: loaded.length, carrying };
  }, mark);

const shapesIn = (scene: SavedScene) =>
  SHAPES.map(({ id }) => scene.elements.find((element) => element.id === id)!);

const overlaps = (scene: SavedScene) => {
  const shapes = shapesIn(scene);
  return shapes.flatMap((a, i) =>
    shapes
      .slice(i + 1)
      .filter(
        (b) =>
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height,
      )
      .map((b) => `${a.id} overlaps ${b.id}`),
  );
};

/** each arrow that lost a binding or whose tip is not at the edge of the shape it binds */
const unbound = (scene: SavedScene) =>
  JOINS.flatMap(([from, to]) => {
    const id = arrowIdOf(from, to);
    const arrow = scene.elements.find((element) => element.id === id);
    if (!arrow?.points || arrow.isDeleted) {
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
    return tips.flatMap(({ end, point: [px, py] }) => {
      const shape = scene.elements.find((element) => element.id === end)!;
      const x = arrow.x + px;
      const y = arrow.y + py;
      const outside = Math.max(
        shape.x - x,
        x - (shape.x + shape.width),
        shape.y - y,
        y - (shape.y + shape.height),
      );
      const distance =
        outside > 0
          ? outside
          : Math.min(
              x - shape.x,
              shape.x + shape.width - x,
              y - shape.y,
              shape.y + shape.height - y,
            );
      return distance > TIP_SLACK
        ? [`${id} ends ${distance}px from ${end}'s edge`]
        : [];
    });
  });

const press = (locator: Locator, hasTouch: boolean) =>
  hasTouch ? locator.tap() : locator.click();

const pointerDrag = async (page: Page, [start, ...rest]: Point[]) => {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const { x, y } of rest) {
    await page.mouse.move(x, y, { steps: 6 });
  }
  await page.mouse.up();
};

test("arranges a scattered chain picked and arranged with the pointer alone, laying it out in a worker", async ({
  page,
}, testInfo) => {
  const hasTouch = !!testInfo.project.use.hasTouch;
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.addInitScript(([key, scene]) => localStorage.setItem(key, scene), [
    SCENE_KEY,
    JSON.stringify(SCENE),
  ] as const);

  await page.goto("/");
  await expect(
    page.locator("canvas.excalidraw__canvas.interactive"),
  ).toBeVisible();
  const loaded = await scriptsCarrying(page, ELK_MARK);
  expect(loaded.loaded).toBeGreaterThan(0);
  expect(loaded.carrying).toEqual([]);

  // a closed loop ending at the far corner selects the same shapes whether
  // the form factor starts on the selection box or the lasso
  const near = { x: 20, y: 200 };
  const far = { x: 375, y: 620 };
  await pointerDrag(page, [
    near,
    { x: far.x, y: near.y },
    far,
    { x: near.x, y: far.y },
    near,
    far,
  ]);

  const arrange = page.getByRole("button", { name: "Auto-arrange" });
  const actions = page.getByTitle("Actions").first();
  await expect(arrange.or(actions).first()).toBeVisible();
  if (!(await arrange.isVisible())) {
    await press(actions, hasTouch);
  }
  await press(arrange, hasTouch);

  await expect
    .poll(async () => {
      const scene = await savedScene(page);
      return scene
        ? shapesIn(scene).filter(
            (shape, i) => shape.x !== SHAPES[i].x || shape.y !== SHAPES[i].y,
          ).length
        : 0;
    })
    .toBeGreaterThan(0);
  const arranged = (await savedScene(page))!;
  expect(overlaps(arranged)).toEqual([]);
  expect(unbound(arranged)).toEqual([]);

  const elkWorkers = workers.filter((url) => /elk-worker/.test(url));
  expect(elkWorkers).toHaveLength(1);
  const { carrying } = await scriptsCarrying(page, ELK_MARK);
  expect(carrying.filter((url) => !elkWorkers.includes(url))).toEqual([]);
  expect(errors).toEqual([]);
});
