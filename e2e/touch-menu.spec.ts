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
