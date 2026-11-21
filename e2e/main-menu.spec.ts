import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("canvas.interactive")).toBeVisible();
});

test("Menu… opens the main menu on screen, where it was picked", async ({
  page,
}) => {
  const viewport = page.viewportSize()!;
  const at = { x: viewport.width * 0.6, y: viewport.height * 0.6 };
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.locator(".context-menu").getByText("Menu…").click();

  const menu = page.locator(".dropdown-menu.main-menu");
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect({
    inside:
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width &&
      box.y + box.height <= viewport.height,
    nearPick:
      Math.abs(box.x - at.x) < viewport.width / 2 &&
      Math.abs(box.y - at.y) < viewport.height,
  }).toEqual({ inside: true, nearPick: true });
  await menu.locator(".dropdown-menu-item").first().click({ trial: true });
});

test("a main menu taller than the space below the pick fits the viewport and scrolls to its last item", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 420 });
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width / 2, viewport.height - 40, {
    button: "right",
  });
  await page.locator(".context-menu").getByText("Menu…").click();

  const menu = page.locator(".dropdown-menu.main-menu");
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.y >= 0 && box.y + box.height <= viewport.height).toBe(true);
  const last = menu.locator(".dropdown-menu-item").last();
  await last.scrollIntoViewIfNeeded();
  await last.click({ trial: true });
});
