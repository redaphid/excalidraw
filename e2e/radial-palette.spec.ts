import { expect, test } from "@playwright/test";

import type { Page, TestInfo } from "@playwright/test";

const SCENE_KEY = "excalidraw-playground-scene";

/** the playground's handle on the editor */
type Playground = Window & {
  excalidrawAPI?: {
    getAppState: () => {
      activeTool: { type: string };
      selectedElementIds: Record<string, true>;
    };
  };
};

type SavedElement = {
  type: string;
  strokeColor: string;
  backgroundColor: string;
  opacity: number;
  strokeOptions?: { variability: string; thinning?: number; taper?: number };
};

const savedElements = (page: Page): Promise<SavedElement[]> =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}").elements ?? [],
    SCENE_KEY,
  );

const center = async (page: Page, testId: string) => {
  const segment = page.getByTestId(testId);
  // a segment's icon or swatch sits inside its sector; the sector's own box
  // can center outside it
  const content = segment.locator(".RadialPalette__segment-content");
  const box = await ((await content.count()) ? content : segment).boundingBox();
  if (!box) {
    throw new Error(`${testId} is not on screen`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** a finger on touch projects, the mouse elsewhere */
const tap = async (page: Page, testInfo: TestInfo, testId: string) => {
  const { x, y } = await center(page, testId);
  if (testInfo.project.use.hasTouch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
};

const drag = async (
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy / 3, { steps: 6 });
  await page.mouse.up();
};

const canvasCenter = async (page: Page) => {
  const viewport = page.viewportSize()!;
  return { x: viewport.width / 2, y: viewport.height / 3 };
};

test.beforeEach(async ({ page }) => {
  await page.goto("/?theme=architect-parchment");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("radial-palette-puck")).toBeVisible();
});

test("opens on a tap, picks a pen and an ink, and draws with them", async ({
  page,
}, testInfo) => {
  await tap(page, testInfo, "radial-palette-puck");
  const ring = page.getByTestId("radial-palette");
  await expect(ring).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ring-open.png") });

  await tap(page, testInfo, "radial-pen-brush");
  await expect(ring).toBeHidden();

  await tap(page, testInfo, "radial-palette-puck");
  await tap(page, testInfo, "radial-color-1");
  await expect(ring).toBeHidden();

  await drag(page, await canvasCenter(page), 120, 60);

  await expect
    .poll(async () => (await savedElements(page)).at(-1))
    .toMatchObject({
      type: "freedraw",
      strokeColor: "#9e3a33",
      opacity: 100,
      strokeOptions: { variability: "variable", thinning: 0.8, taper: 10 },
    });
});

test("picks a tool with one flick from the puck", async ({ page }) => {
  const puck = await center(page, "radial-palette-puck");
  await page.mouse.move(puck.x, puck.y);
  await page.mouse.down();
  // the ring opens once the pointer leaves the puck, so a still press can
  // become a hold that moves it
  await page.mouse.move(puck.x - 20, puck.y - 20, { steps: 4 });
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  const rectangle = await center(page, "radial-tool-rectangle");
  await page.mouse.move(rectangle.x, rectangle.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("radial-palette")).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as Playground).excalidrawAPI?.getAppState().activeTool.type,
    ),
  ).toBe("rectangle");
});

/** a finger or a pen held on the canvas: real input through CDP in
 * Chromium, synthetic pointer events elsewhere (which test the editor's
 * handling, not the browser's own gesture recognition) */
const contact = async (
  page: Page,
  browserName: string,
  kind: "touch" | "pen",
) => {
  const cdp =
    browserName === "chromium"
      ? await page.context().newCDPSession(page)
      : null;
  if (!cdp) {
    // the browser never saw the synthetic pointer go down, so capturing it
    // throws NotFoundError (Firefox, WebKit) before the editor handles it
    await page.evaluate(() => {
      for (const name of [
        "setPointerCapture",
        "releasePointerCapture",
      ] as const) {
        const real = Element.prototype[name];
        Element.prototype[name] = function (this: Element, id: number) {
          if (id !== 41) {
            real.call(this, id);
          }
        };
      }
    });
  }
  const synthetic = (type: string, x: number, y: number, buttons: number) =>
    page.evaluate(
      ({ type, x, y, buttons, kind }) => {
        const canvas = document.querySelector(
          "canvas.excalidraw__canvas.interactive",
        )!;
        const target =
          type === "pointerdown" ? canvas : document.elementFromPoint(x, y)!;
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 41,
            pointerType: kind,
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: type === "pointermove" ? -1 : kind === "pen" ? 2 : 0,
            buttons,
          }),
        );
      },
      { type, x, y, buttons, kind },
    );
  const held = kind === "pen" ? 2 : 1;
  const mouse = (type: string, x: number, y: number, buttons: number) =>
    cdp!.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "right",
      buttons,
      clickCount: type === "mouseMoved" ? 0 : 1,
      pointerType: "pen",
    });
  return {
    down: async (x: number, y: number) => {
      if (!cdp) {
        return synthetic("pointerdown", x, y, held);
      }
      if (kind === "touch") {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 1 }],
        });
      } else {
        await mouse("mousePressed", x, y, 2);
      }
    },
    move: async (x: number, y: number) => {
      if (!cdp) {
        return synthetic("pointermove", x, y, held);
      }
      if (kind === "touch") {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y, id: 1 }],
        });
      } else {
        await mouse("mouseMoved", x, y, 2);
      }
    },
    up: async (x: number, y: number) => {
      if (!cdp) {
        return synthetic("pointerup", x, y, 0);
      }
      if (kind === "touch") {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      } else {
        await mouse("mouseReleased", x, y, 0);
      }
    },
  };
};

const ringCenter = async (page: Page) => {
  const box = (await page.getByTestId("radial-palette").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const activeTool = (page: Page) =>
  page.evaluate(
    () => (window as Playground).excalidrawAPI?.getAppState().activeTool.type,
  );

test("the puck stays in reach beside an open sidebar", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.endsWith("-phone"),
    "a phone's sidebar covers the whole editor",
  );
  await page.evaluate(() =>
    (
      window as Window & {
        excalidrawAPI?: {
          toggleSidebar: (opts: { name: string; force: boolean }) => void;
        };
      }
    ).excalidrawAPI!.toggleSidebar({ name: "default", force: true }),
  );
  await expect(page.locator(".sidebar")).toBeVisible();
  await tap(page, testInfo, "radial-palette-puck");
  await expect(page.getByTestId("radial-palette")).toBeVisible();
});

test("opens at the pointer on , and closes on Escape", async ({ page }) => {
  const { x, y } = await canvasCenter(page);
  await page.mouse.move(x, y);
  await page.keyboard.press(",");
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  const ring = await ringCenter(page);
  expect(Math.abs(ring.x - x)).toBeLessThan(2);
  expect(Math.abs(ring.y - y)).toBeLessThan(2);
  await expect(page.getByTestId("radial-role-error")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("radial-palette")).toBeHidden();
});

test("Tab walks the ring opened on , and never reaches the shape behind it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.use.hasTouch, "a keyboard gesture");
  const { x, y } = await canvasCenter(page);
  await page.keyboard.press("r");
  await page.mouse.move(x - 60, y - 40);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await savedElements(page)).length).toBe(1);

  await page.keyboard.press(",");
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  const inRing = () =>
    page.evaluate(
      () =>
        !!document
          .querySelector('[data-testid="radial-palette"]')
          ?.contains(document.activeElement),
    );
  expect(await inRing(), "focus is on the ring's items").toBe(true);
  await expect(page.locator(".ConvertElementTypePopup")).toHaveCount(0);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  // past the last item it wraps, and never lands on the editor
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
  }
  expect(await inRing(), "still in the ring after 40 Tabs").toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await savedElements(page))[0]?.type).toBe(
    "rectangle",
  );
});

test("a finger held still opens the ring under it, and a flick picks a shape", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "a touch gesture");
  const { x, y } = await canvasCenter(page);
  const finger = await contact(page, browserName, "touch");
  await finger.down(x, y);
  await finger.move(x + 3, y + 2);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  await expect(page.locator(".context-menu")).toHaveCount(0);
  const ring = await ringCenter(page);
  expect(Math.abs(ring.x - (x + 3))).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("long-press.png") });

  const ellipse = await center(page, "radial-tool-ellipse");
  await finger.move((x + ellipse.x) / 2, (y + ellipse.y) / 2);
  await finger.move(ellipse.x, ellipse.y);
  await finger.up(ellipse.x, ellipse.y);
  await expect(page.getByTestId("radial-palette")).toBeHidden();
  expect(await activeTool(page)).toBe("ellipse");
  expect(await savedElements(page)).toEqual([]);
});

test("a pen with its barrel button held opens the ring at the tip", async ({
  page,
  browserName,
}) => {
  const { x, y } = await canvasCenter(page);
  const pen = await contact(page, browserName, "pen");
  await pen.down(x, y);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  const ring = await ringCenter(page);
  expect(Math.abs(ring.x - x)).toBeLessThan(2);
  expect(Math.abs(ring.y - y)).toBeLessThan(2);
  await pen.up(x, y);
  await expect(page.locator(".context-menu")).toHaveCount(0);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
});

test("a held puck moves, tucks against a side, comes back, and stays put", async ({
  page,
}, testInfo) => {
  const puck = page.getByTestId("radial-palette-puck");
  const viewport = page.viewportSize()!;
  const middle = { x: viewport.width / 2, y: viewport.height / 2 };
  const centerOf = async () => {
    const box = (await puck.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const holdAndDrag = async (to: { x: number; y: number }) => {
    const from = await centerOf();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };

  await holdAndDrag(middle);
  await expect(page.getByTestId("radial-palette")).toBeHidden();
  await page.reload();
  const kept = await centerOf();
  expect(Math.hypot(kept.x - middle.x, kept.y - middle.y)).toBeLessThan(2);

  await holdAndDrag({ x: viewport.width - 4, y: middle.y });
  await expect(puck).toHaveClass(/RadialPalette__puck--collapsed/);
  await page.screenshot({ path: testInfo.outputPath("puck-tucked.png") });

  await tap(page, testInfo, "radial-palette-puck");
  await expect(puck).not.toHaveClass(/RadialPalette__puck--collapsed/);
  await expect(page.getByTestId("radial-palette")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("puck-back.png") });
});

test("a held hub carries the open ring, which stays open where it lands", async ({
  page,
  browserName,
}, testInfo) => {
  const viewport = page.viewportSize()!;
  const to = { x: viewport.width / 2, y: viewport.height / 2 };
  await tap(page, testInfo, "radial-palette-puck");
  const ring = page.getByTestId("radial-palette");
  await expect(ring).toBeVisible();
  const from = await center(page, "radial-palette-menu");
  // a real finger in Chromium, so the browser sends its own long-press menu
  const finger =
    browserName === "chromium" && testInfo.project.use.hasTouch
      ? await contact(page, browserName, "touch")
      : {
          down: async (x: number, y: number) => {
            await page.mouse.move(x, y);
            await page.mouse.down();
          },
          move: (x: number, y: number) => page.mouse.move(x, y),
          up: () => page.mouse.up(),
        };

  await finger.down(from.x, from.y);
  await page.waitForTimeout(700);
  await expect(ring).toHaveClass(/RadialPalette--moving/);
  await page.screenshot({ path: testInfo.outputPath("ring-lifted.png") });
  for (let step = 1; step <= 8; step++) {
    await finger.move(
      from.x + ((to.x - from.x) * step) / 8,
      from.y + ((to.y - from.y) * step) / 8,
    );
  }
  await finger.up(to.x, to.y);

  await expect(ring).toBeVisible();
  await expect(ring).not.toHaveClass(/RadialPalette--moving/);
  const landed = await ringCenter(page);
  expect(Math.hypot(landed.x - to.x, landed.y - to.y)).toBeLessThan(2);
  await expect(page.locator(".context-menu")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("ring-dropped.png") });

  await page.keyboard.press("Escape");
  await expect(ring).toBeHidden();
  const puck = (await page.getByTestId("radial-palette-puck").boundingBox())!;
  const puckAt = { x: puck.x + puck.width / 2, y: puck.y + puck.height / 2 };
  expect(Math.hypot(puckAt.x - to.x, puckAt.y - to.y)).toBeLessThan(2);
});

test("a ring carried by its hub keeps its finger when another lands, and opens there after a reload", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium" || !testInfo.project.use.hasTouch,
    "two real fingers need Chromium's CDP touch",
  );
  const viewport = page.viewportSize()!;
  const to = { x: viewport.width / 2, y: viewport.height / 2 };
  await tap(page, testInfo, "radial-palette-puck");
  const ring = page.getByTestId("radial-palette");
  await expect(ring).toBeVisible();
  const from = await center(page, "radial-palette-menu");
  const cdp = await page.context().newCDPSession(page);
  // the other hand's finger rests near the bottom left corner, off the ring
  const other = { x: 24, y: viewport.height - 24, id: 2 };
  const fingers = (points: { x: number; y: number; id: number }[]) =>
    points.map(({ x, y, id }) => ({ x, y, id }));
  const send = (type: string, points: { x: number; y: number; id: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: fingers(points),
    });

  await send("touchStart", [{ ...from, id: 1 }]);
  await page.waitForTimeout(700);
  await expect(ring).toHaveClass(/RadialPalette--moving/);
  const half = {
    x: from.x + (to.x - from.x) / 2,
    y: from.y + (to.y - from.y) / 2,
  };
  await send("touchMove", [{ ...half, id: 1 }]);
  await send("touchStart", [{ ...half, id: 1 }, other]);
  await expect(ring).toBeVisible();
  for (let step = 1; step <= 6; step++) {
    const at = {
      x: half.x + ((to.x - half.x) * step) / 6,
      y: half.y + ((to.y - half.y) * step) / 6,
    };
    await send("touchMove", [
      { ...at, id: 1 },
      { ...other, x: other.x + step * 4 },
    ]);
  }
  await page.screenshot({ path: testInfo.outputPath("two-fingers.png") });
  await send("touchEnd", [{ ...other, x: other.x + 24 }]);
  await send("touchEnd", []);

  await expect(ring).toBeVisible();
  const landed = await ringCenter(page);
  expect(Math.hypot(landed.x - to.x, landed.y - to.y)).toBeLessThan(2);
  await expect(page.locator(".context-menu")).toHaveCount(0);

  await page.reload();
  await tap(page, testInfo, "radial-palette-puck");
  await expect(ring).toBeVisible();
  const reopened = await ringCenter(page);
  expect(Math.hypot(reopened.x - to.x, reopened.y - to.y)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("after-reload.png") });
});

test("a finger held on a selected shape and lifted leaves only the ring", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "a touch gesture");
  // drawn around the canvas centre: once R picks the rectangle, a tablet
  // shows the shape's properties island on the left, over x 120
  const { x, y } = await canvasCenter(page);
  await page.keyboard.press("r");
  await page.mouse.move(x - 80, y - 75);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 75, { steps: 6 });
  await page.mouse.up();
  expect(await activeTool(page)).toBe("selection");
  expect(
    await page.evaluate(
      () =>
        Object.keys(
          (window as Playground).excalidrawAPI!.getAppState()
            .selectedElementIds,
        ).length,
    ),
  ).toBe(1);

  const finger = await contact(page, browserName, "touch");
  await finger.down(x, y);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  await finger.up(x, y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("held-lifted.png") });

  await expect(page.locator(".context-menu")).toHaveCount(0);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
});

test("the hub opens the selection's menu, where two shapes line up", async ({
  page,
}, testInfo) => {
  const { x, y } = await canvasCenter(page);
  for (const [left, top] of [
    [x - 110, y + 30],
    [x + 20, y + 70],
  ]) {
    await page.keyboard.press("r");
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(left + 70, top + 50, { steps: 4 });
    await page.mouse.up();
  }
  await page.keyboard.press("ControlOrMeta+a");

  await tap(page, testInfo, "radial-palette-puck");
  await tap(page, testInfo, "radial-palette-menu");
  const menu = page.locator(".context-menu");
  await expect(menu.getByTestId("deleteSelectedElements")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hub-selection.png") });

  await menu.getByTestId("alignLeft").click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          new Set(
            (JSON.parse(localStorage.getItem(key) ?? "{}").elements ?? []).map(
              (element: { x: number }) => Math.round(element.x),
            ),
          ).size,
        SCENE_KEY,
      ),
    )
    .toBe(1);
});

test("its corner scales the ring as a frame's does, and the size stays", async ({
  page,
}, testInfo) => {
  const ring = page.getByTestId("radial-palette");
  const handle = page.getByTestId("radial-palette-scale");
  // its layout width: the box also has the opening animation's scale in it
  const width = () =>
    ring.evaluate((element) => (element as HTMLElement).offsetWidth);
  const middleOf = async (target: typeof ring) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  await tap(page, testInfo, "radial-palette-puck");
  await expect(ring).toBeVisible();
  await ring.evaluate((element) =>
    Promise.all(
      element.getAnimations({ subtree: true }).map(({ finished }) => finished),
    ),
  );
  const before = await width();
  const from = await middleOf(handle);
  const center = await middleOf(ring);
  const out = {
    x: Math.sign(from.x - center.x),
    y: Math.sign(from.y - center.y),
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + out.x, from.y);
  expect(Math.abs((await width()) - before)).toBeLessThan(2);

  const to = { x: from.x + out.x * 30, y: from.y + out.y * 30 };
  await page.mouse.move(to.x, to.y, { steps: 6 });
  const held = await middleOf(handle);
  expect(Math.hypot(held.x - to.x, held.y - to.y)).toBeLessThan(2);
  await page.mouse.up();
  await page.screenshot({ path: testInfo.outputPath("ring-scaled.png") });
  const scaled = await width();
  expect(scaled).toBeGreaterThan(before);

  await page.reload();
  await tap(page, testInfo, "radial-palette-puck");
  await expect(ring).toBeVisible();
  expect(await width()).toBeCloseTo(scaled, 0);
});
