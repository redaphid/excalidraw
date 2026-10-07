import fs from "fs";

import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const SCENE_KEY = "excalidraw-playground-scene";
const LONG_TASK_MS = 200;

type Phase = "load" | "draw" | "pan" | "zoom";
type LongTaskSource = "longtask" | "frame-gap";
type LongTask = { phase: Phase; ms: number };

type Point = { x: number; y: number };

type SavedScene = {
  elements: { type: string; text?: string }[];
  appState: { zoom: { value: number }; scrollX: number; scrollY: number };
};

declare global {
  interface Window {
    smokePhase: Phase;
    smokeLongTasks: LongTask[];
    smokeLongTaskSource: LongTaskSource;
  }
}

const watchLongTasks = (thresholdMs: number) => {
  window.smokePhase = "load";
  window.smokeLongTasks = [];
  const record = (ms: number) => {
    if (ms > thresholdMs) {
      window.smokeLongTasks.push({
        phase: window.smokePhase,
        ms: Math.round(ms),
      });
    }
  };
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    window.smokeLongTaskSource = "longtask";
    new PerformanceObserver((list) =>
      list.getEntries().forEach((entry) => record(entry.duration)),
    ).observe({ type: "longtask" });
    return;
  }
  window.smokeLongTaskSource = "frame-gap";
  let last = performance.now();
  const onFrame = (now: number) => {
    record(now - last);
    last = now;
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
};

const setPhase = (page: Page, phase: Phase) =>
  page.evaluate((phase) => {
    window.smokePhase = phase;
  }, phase);

const savedScene = (page: Page): Promise<SavedScene | null> =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    SCENE_KEY,
  );

const inkedPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.static",
    )!;
    const { data } = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        data[i] !== data[0] ||
        data[i + 1] !== data[1] ||
        data[i + 2] !== data[2]
      ) {
        inked++;
      }
    }
    return inked;
  });

const mouseDrag = async (page: Page, [start, ...rest]: Point[]) => {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const { x, y } of rest) {
    await page.mouse.move(x, y, { steps: 4 });
  }
  await page.mouse.up();
};

const focusEditor = (page: Page, { x, y }: Point) => page.mouse.click(x, y);

test.afterEach(async ({ page }, testInfo) => {
  const { tasks, source } = await page.evaluate(() => ({
    tasks: window.smokeLongTasks.filter((task) => task.phase !== "load"),
    source: window.smokeLongTaskSource,
  }));
  const project = testInfo.project.name;
  const found = tasks.map(({ ms, phase }) => `${ms} ms during ${phase}`);
  for (const task of found) {
    process.stdout.write(
      `::warning title=Long task over ${LONG_TASK_MS} ms::${project}: ${task} (${source})\n`,
    );
  }
  const summary = found.length
    ? `WARNING ${
        found.length
      } long task(s) over ${LONG_TASK_MS} ms: ${found.join(", ")}`
    : `no long tasks over ${LONG_TASK_MS} ms during draw, pan or zoom`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `- **${project}** (${source}): ${summary}\n`,
    );
  }
});

test("draws, pans and zooms with no console errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(watchLongTasks, LONG_TASK_MS);

  await page.goto("/");
  await expect(
    page.locator("canvas.excalidraw__canvas.interactive"),
  ).toBeVisible();
  const { width, height } = page.viewportSize()!;
  const at = (fx: number, fy: number) => ({
    x: Math.round(width * fx),
    y: Math.round(height * fy),
  });
  const tap = ({ x, y }: Point) =>
    testInfo.project.use.hasTouch
      ? page.touchscreen.tap(x, y)
      : page.mouse.click(x, y);
  const blankPixels = await inkedPixels(page);

  await setPhase(page, "draw");
  await focusEditor(page, at(0.5, 0.8));
  await page.keyboard.press("r");
  await mouseDrag(page, [at(0.3, 0.3), at(0.55, 0.4)]);
  await page.keyboard.press("a");
  await mouseDrag(page, [at(0.6, 0.3), at(0.85, 0.4)]);
  await page.keyboard.press("p");
  await mouseDrag(page, [
    at(0.3, 0.5),
    at(0.45, 0.56),
    at(0.6, 0.5),
    at(0.75, 0.56),
  ]);
  await page.keyboard.press("t");
  await tap(at(0.35, 0.65));
  await page.keyboard.type("smoke");
  await page.keyboard.press("Escape");

  await expect
    .poll(async () =>
      (await savedScene(page))?.elements.map(({ type }) => type).sort(),
    )
    .toEqual(["arrow", "freedraw", "rectangle", "text"]);
  const drawn = (await savedScene(page))!;
  expect(drawn.elements.find(({ type }) => type === "text")?.text).toBe(
    "smoke",
  );
  await expect
    .poll(() => inkedPixels(page))
    .toBeGreaterThan(blankPixels + 1000);

  await setPhase(page, "pan");
  await page.mouse.move(at(0.5, 0.5).x, at(0.5, 0.5).y);
  await page.mouse.wheel(80, 120);
  await expect
    .poll(async () => {
      const { scrollX, scrollY } = (await savedScene(page))!.appState;
      return { scrollX, scrollY };
    })
    .not.toEqual({
      scrollX: drawn.appState.scrollX,
      scrollY: drawn.appState.scrollY,
    });

  await setPhase(page, "zoom");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await savedScene(page))!.appState.zoom.value)
    .toBeGreaterThan(drawn.appState.zoom.value);

  expect(errors).toEqual([]);
});
