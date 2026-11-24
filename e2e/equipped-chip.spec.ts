import { expect, test } from "@playwright/test";

import type { Page, TestInfo } from "@playwright/test";

/** the playground's handle on the editor */
type Playground = Window & {
  excalidrawAPI?: { getAppState: () => { activeTool: { type: string } } };
};

const activeTool = (page: Page) =>
  page.evaluate(
    () => (window as Playground).excalidrawAPI?.getAppState().activeTool.type,
  );

const middle = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`${testId} is not on screen`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** a finger on touch projects, the mouse elsewhere */
const tap = async (page: Page, testInfo: TestInfo, testId: string) => {
  const { x, y } = await middle(page, testId);
  if (testInfo.project.use.hasTouch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
};

/** picks the rectangle from the ring: equips it */
const equipRectangle = async (page: Page, testInfo: TestInfo) => {
  await tap(page, testInfo, "radial-palette-puck");
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  await tap(page, testInfo, "radial-tool-rectangle");
  await expect(page.getByTestId("radial-palette")).toBeHidden();
  expect(await activeTool(page)).toBe("rectangle");
};

const chip = (page: Page) => page.getByTestId("radial-palette-equipped");

test.beforeEach(async ({ page }) => {
  await page.goto("/?theme=architect-parchment");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("radial-palette-puck")).toBeVisible();
  // start from the hand, as draw does on a phone
  await page.keyboard.press("h");
});

test("an equipped tool floats on the palette's edge, in the editor, a thumb wide", async ({
  page,
}, testInfo) => {
  await expect(chip(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("1-hand.png") });

  await equipRectangle(page, testInfo);
  await expect(chip(page)).toBeVisible();
  await expect(chip(page)).toHaveAttribute("data-tool", "rectangle");
  await page.screenshot({ path: testInfo.outputPath("2-equipped.png") });

  const box = (await chip(page).boundingBox())!;
  const puck = (await page.getByTestId("radial-palette-puck").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // beside the puck: touching its rim, not on top of it
  const gap = Math.hypot(
    box.x + box.width / 2 - (puck.x + puck.width / 2),
    box.y + box.height / 2 - (puck.y + puck.height / 2),
  );
  expect(gap).toBeGreaterThan(puck.width / 2);
  expect(gap).toBeLessThan(puck.width / 2 + box.width);

  // and on the open ring's rim too
  await tap(page, testInfo, "radial-palette-puck");
  await expect(page.getByTestId("radial-palette")).toBeVisible();
  await expect(chip(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("3-ring-open.png") });
});

test("x puts the equipped tool down and picks up the hand", async ({
  page,
}, testInfo) => {
  await equipRectangle(page, testInfo);
  await page.keyboard.press("x");
  await expect.poll(() => activeTool(page)).toBe("hand");
  await expect(chip(page)).toBeHidden();
});

test("a tap on the chip puts the tool down and picks up the hand", async ({
  page,
}, testInfo) => {
  await equipRectangle(page, testInfo);
  await tap(page, testInfo, "radial-palette-equipped");
  await expect.poll(() => activeTool(page)).toBe("hand");
  await expect(chip(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("4-put-down.png") });
});
