import { expect, test } from "@playwright/test";

import type { Page, TestInfo } from "@playwright/test";

const SCENE_KEY = "excalidraw-playground-scene";

/** the playground's handle on the editor */
type Playground = Window & {
  excalidrawAPI?: { getAppState: () => { activeTool: { type: string } } };
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

test("a finger held on a selected shape and lifted leaves only the ring", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "a touch gesture");
  await page.keyboard.press("r");
  await page.mouse.move(120, 250);
  await page.mouse.down();
  await page.mouse.move(280, 400, { steps: 6 });
  await page.mouse.up();
  expect(await activeTool(page)).toBe("selection");

  const finger = await contact(page, browserName, "touch");
  await finger.down(200, 325);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  await finger.up(200, 325);
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("held-lifted.png") });

  await expect(page.locator(".context-menu")).toHaveCount(0);
  await expect(page.getByTestId("radial-palette")).toBeVisible();
});
