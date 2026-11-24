import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Pin a frame to the screen (#240): it keeps its screen place and size
// while the board pans and zooms, drags to move, and two quick taps put it
// back on the board where it was shown.

type AppState = {
  selectedElementIds: Record<string, true>;
  pinnedFrames: Record<string, { x: number; y: number; scale: number }>;
  zoom: { value: number };
  scrollX: number;
  scrollY: number;
};

type Api = {
  getAppState: () => AppState;
  getSceneElements: () => readonly { id: string; type: string }[];
  setActiveTool: (tool: { type: string }) => void;
  updateScene: (scene: { appState?: Partial<AppState> }) => void;
};

type Playground = Window & { excalidrawAPI?: Api | null };

const appState = (page: Page) =>
  page.evaluate(() => (window as Playground).excalidrawAPI!.getAppState());

const pinned = (page: Page) => page.locator(".PinnedFrame");

/** draws a frame from (left, top) to (right, bottom), which leaves it selected */
const drawFrame = async (
  page: Page,
  [left, top, right, bottom]: [number, number, number, number],
) => {
  await page.evaluate(() =>
    (window as Playground).excalidrawAPI!.setActiveTool({ type: "frame" }),
  );
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move((left + right) / 2, (top + bottom) / 2, { steps: 4 });
  await page.mouse.move(right, bottom, { steps: 4 });
  await page.mouse.up();
  const frames = await page.evaluate(() =>
    (window as Playground)
      .excalidrawAPI!.getSceneElements()
      .filter(({ type }) => type === "frame")
      .map(({ id }) => id),
  );
  expect(frames).toHaveLength(1);
  return frames[0];
};

test.beforeEach(async ({ page }) => {
  await page.goto("/?switcher=0");
  await page.waitForFunction(() => !!(window as Playground).excalidrawAPI);
});

test("a pinned frame stays put while the board moves, then drops back on two taps", async ({
  page,
}, testInfo) => {
  const touch = !!testInfo.project.use.hasTouch;
  const viewport = page.viewportSize()!;
  const left = Math.round(viewport.width * 0.3);
  const top = Math.round(viewport.height * 0.35);
  const id = await drawFrame(page, [left, top, left + 160, top + 120]);
  expect((await appState(page)).selectedElementIds).toEqual({ [id]: true });

  // the frame's own menu: press on its edge
  await page.mouse.click(left, top + 60, { button: "right" });
  await page.getByTestId("pinFrame").click();

  await expect(pinned(page)).toBeVisible();
  await expect(pinned(page).locator("svg")).toHaveCount(1);
  const before = (await pinned(page).boundingBox())!;
  expect(before.width).toBeGreaterThan(140);

  // the board pans and zooms under it
  await page.evaluate(() =>
    (window as Playground).excalidrawAPI!.updateScene({
      appState: { scrollX: -400, scrollY: 250, zoom: { value: 2 } },
    }),
  );
  await page.waitForTimeout(100);
  const after = (await pinned(page).boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(after[key] - before[key])).toBeLessThan(1);
  }

  // dragged, it moves; the board does not
  const grab = { x: before.x + before.width / 2, y: before.y + 20 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 30, grab.y + 20, { steps: 3 });
  await page.mouse.move(grab.x - 60, grab.y + 40, { steps: 3 });
  await page.mouse.up();
  const dragged = (await pinned(page).boundingBox())!;
  expect(Math.round(dragged.x - before.x)).toBe(-60);
  expect(Math.round(dragged.y - before.y)).toBe(40);
  const moved = await appState(page);
  expect([moved.scrollX, moved.scrollY, moved.zoom.value]).toEqual([
    -400, 250, 2,
  ]);

  // two quick taps: back on the board, where it was shown
  const tap = { x: dragged.x + dragged.width / 2, y: dragged.y + 20 };
  if (touch) {
    await page.touchscreen.tap(tap.x, tap.y);
    await page.touchscreen.tap(tap.x, tap.y);
  } else {
    await page.mouse.dblclick(tap.x, tap.y);
  }
  await expect(pinned(page)).toHaveCount(0);
  const dropped = await appState(page);
  expect(dropped.pinnedFrames).toEqual({});
  expect(dropped.zoom.value).toBe(1);
  expect(dropped.selectedElementIds).toEqual({ [id]: true });
});
