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

const drag = async (page: Page, from: { x: number; y: number }, dx: number, dy: number) => {
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

test("gives a drawn rectangle a style role", async ({ page }, testInfo) => {
  await tap(page, testInfo, "radial-palette-puck");
  await tap(page, testInfo, "radial-tool-rectangle");
  const { x, y } = await canvasCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 60, { steps: 6 });
  await page.mouse.up();

  await tap(page, testInfo, "radial-palette-puck");
  await tap(page, testInfo, "radial-role-error");

  await expect
    .poll(async () =>
      (await savedElements(page)).find(({ type }) => type === "rectangle"),
    )
    .toMatchObject({ strokeColor: "#9e3a33", backgroundColor: "#ebe4d6" });
});
