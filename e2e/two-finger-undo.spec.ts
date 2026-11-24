import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

type Point = { x: number; y: number };

type Playground = Window & {
  excalidrawAPI?: {
    getSceneElements: () => readonly unknown[];
    getAppState: () => { zoom: { value: number } };
  };
};

type Phase = "down" | "move" | "up";

/**
 * Puts touches on the canvas through the DevTools protocol, real touch input
 * as a touch screen sends it. `fingers` lists every finger on the glass.
 */
const touchscreen = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  const types = { down: "touchStart", move: "touchMove", up: "touchEnd" };
  return (phase: Phase, fingers: Point[]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type: types[phase],
      touchPoints:
        phase === "up"
          ? []
          : fingers.map(({ x, y }, id) => ({ x, y, id, radiusX: 4 })),
    });
};

const liveShapes = (page: Page) =>
  page.evaluate(
    () =>
      (window as Playground)
        .excalidrawAPI!.getSceneElements()
        .filter((element) => !(element as { isDeleted: boolean }).isDeleted)
        .length,
  );

const zoom = (page: Page) =>
  page.evaluate(
    () => (window as Playground).excalidrawAPI!.getAppState().zoom.value,
  );

test.beforeEach(async ({ page, browserName }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "a touch screen");
  test.skip(
    browserName !== "chromium",
    "multi-touch input, which Playwright drives in Chromium only",
  );
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => !!(window as Playground).excalidrawAPI))
    .toBe(true);
});

test("a double two-finger tap undoes the shape just drawn", async ({
  page,
}) => {
  const touch = await touchscreen(page);
  const drawRectangle = async (from: Point) => {
    await page.keyboard.press("r");
    await touch("down", [from]);
    for (let step = 1; step <= 5; step++) {
      await touch("move", [{ x: from.x + step * 12, y: from.y + step * 12 }]);
    }
    await touch("up", [{ x: from.x + 60, y: from.y + 60 }]);
  };
  const twoFingerTap = async () => {
    const fingers = [
      { x: 150, y: 560 },
      { x: 220, y: 560 },
    ];
    await touch("down", fingers.slice(0, 1));
    await touch("down", fingers);
    await page.waitForTimeout(40);
    await touch("up", fingers);
  };

  await drawRectangle({ x: 60, y: 260 });
  await drawRectangle({ x: 200, y: 260 });
  await expect.poll(() => liveShapes(page)).toBe(2);

  await twoFingerTap();
  await page.waitForTimeout(100);
  await twoFingerTap();
  await expect.poll(() => liveShapes(page)).toBe(1);

  await page.keyboard.press("Control+Shift+Z");
  await expect.poll(() => liveShapes(page)).toBe(2);
});

test("two quick two-finger pinches undo nothing", async ({ page }) => {
  const touch = await touchscreen(page);
  await page.keyboard.press("r");
  await touch("down", [{ x: 100, y: 300 }]);
  await touch("move", [{ x: 160, y: 360 }]);
  await touch("up", [{ x: 160, y: 360 }]);
  await expect.poll(() => liveShapes(page)).toBe(1);
  const before = await zoom(page);

  const pinch = async () => {
    await touch("down", [{ x: 170, y: 560 }]);
    await touch("down", [
      { x: 170, y: 560 },
      { x: 210, y: 560 },
    ]);
    for (let step = 1; step <= 4; step++) {
      await touch("move", [
        { x: 170 - step * 15, y: 560 },
        { x: 210 + step * 15, y: 560 },
      ]);
    }
    await touch("up", [
      { x: 110, y: 560 },
      { x: 270, y: 560 },
    ]);
  };
  await pinch();
  await page.waitForTimeout(100);
  await pinch();

  await expect.poll(() => zoom(page)).not.toBe(before);
  expect(await liveShapes(page)).toBe(1);
});
