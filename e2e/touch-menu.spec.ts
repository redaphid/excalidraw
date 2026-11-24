import { expect, test } from "@playwright/test";

import type { Page, TestInfo } from "@playwright/test";

// a phone or a tablet, as the browser reports one: Firefox has no isMobile
test.use({
  isMobile: async ({ browserName, hasTouch }, use) =>
    use(hasTouch && browserName !== "firefox"),
});

const tap = async (page: Page, testInfo: TestInfo, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`${testId} is not on screen`);
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (testInfo.project.use.hasTouch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
};

test.beforeEach(async ({ page }) => {
  await page.goto("/?theme=architect-parchment");
  await expect(page.getByTestId("radial-palette-puck")).toBeVisible();
});

test("the radial hub's menu fits a thumb on a touch screen", async ({
  page,
}, testInfo) => {
  test.skip(
    !(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)),
    "a touch screen's coarse pointer",
  );
  await tap(page, testInfo, "radial-palette-puck");
  await tap(page, testInfo, "radial-palette-menu");
  await expect(page.locator(".context-menu")).toBeVisible();
  const rows = await page.locator(".context-menu-item").evaluateAll((items) =>
    items.map((item) => ({
      label: item.querySelector(".context-menu-item__label")?.textContent,
      height: Math.round(item.getBoundingClientRect().height),
      shortcut:
        getComputedStyle(item.querySelector(".context-menu-item__shortcut")!)
          .display !== "none",
    })),
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(
    rows.filter(({ height, shortcut }) => height < 44 || shortcut),
  ).toEqual([]);
});

test("on a phone the hub's menu for three shapes ends on the screen, rows still thumb-sized", async ({
  page,
}, testInfo) => {
  test.skip(
    !(await page.evaluate(
      () =>
        matchMedia("(pointer: coarse)").matches && window.innerHeight <= 1000,
    )),
    "a phone-sized touch screen",
  );
  const { width, height } = page.viewportSize()!;
  for (const [left, top] of [
    [40, 140],
    [160, 200],
    [260, 140],
  ]) {
    await page.keyboard.press("r");
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(left + 60, top + 40, { steps: 4 });
    await page.mouse.up();
  }
  await page.keyboard.press("ControlOrMeta+a");

  await tap(page, testInfo, "radial-palette-puck");
  await tap(page, testInfo, "radial-palette-menu");
  const menu = page.locator(".context-menu");
  await expect(menu.getByTestId("deleteSelectedElements")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hub-three-shapes.png") });

  const box = (await menu.boundingBox())!;
  expect({
    bottom: box.y + box.height <= height,
    right: box.x + box.width <= width,
  }).toEqual({
    bottom: true,
    right: true,
  });
  const small = await page.locator(".context-menu-item").evaluateAll((items) =>
    items
      .map((item) => item.getBoundingClientRect())
      .filter((r) => r.height < 44 || r.width < 44)
      .map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});
