import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

const { values: opts } = parseArgs({
  options: {
    root: {
      type: "string",
      default: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    },
    url: { type: "string", default: "http://127.0.0.1:3001/" },
    out: { type: "string" },
    shapes: { type: "string", default: "4000" },
  },
});
if (opts.out) {
  mkdirSync(opts.out, { recursive: true });
}

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(opts.url);
await page.waitForFunction(
  () => window.h?.app && !window.h.state.isLoading,
  null,
  { timeout: 120_000 },
);

await page.evaluate(
  async ({ root, shapes }) => {
    const excalidraw = await import(
      `/@fs${root}/packages/excalidraw/index.tsx`
    );
    window.cullCheck = await import(
      `/@fs${root}/packages/element/src/sizeHelpers.ts`
    );
    let seed = 5;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const skeletons = [];
    for (let i = 0; i < shapes; i++) {
      const x = random() * 16000 - 4000;
      const y = random() * 10000 - 3000;
      skeletons.push(
        i % 4 === 3
          ? {
              type: "arrow",
              x,
              y,
              width: 120,
              height: 40,
              label: { text: `a${i}` },
            }
          : {
              type: ["rectangle", "ellipse", "diamond"][i % 4],
              x,
              y,
              width: 60 + random() * 120,
              height: 40 + random() * 80,
              label: { text: `s${i}` },
            },
      );
    }
    window.h.app.updateScene({
      elements: excalidraw.convertToExcalidrawElements(skeletons, {
        regenerateIds: false,
      }),
      appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
      captureUpdate: "IMMEDIATELY",
    });
  },
  { root: opts.root, shapes: Number(opts.shapes) },
);

const nextFrames = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

const stats = { frames: 0, mismatches: 0, mostVisible: 0 };
const check = async (label) => {
  await nextFrames();
  const result = await page.evaluate(() => {
    const { h, cullCheck } = window;
    const state = h.state;
    const elementsMap = h.app.scene.getNonDeletedElementsMap();
    const scan = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          element.id !== state.editingTextElement?.id &&
          (element.id !== state.newElement?.id || state.newElement.frameId) &&
          cullCheck.isElementInViewport(
            element,
            state.width,
            state.height,
            state,
            elementsMap,
          ),
      )
      .map((element) => element.id);
    const culled = h.app.visibleElements.map((element) => element.id);
    return {
      visible: culled.length,
      same:
        scan.length === culled.length &&
        scan.every((id, i) => id === culled[i]),
      missing: scan.filter((id) => !culled.includes(id)).slice(0, 5),
      extra: culled.filter((id) => !scan.includes(id)).slice(0, 5),
    };
  });
  stats.frames++;
  stats.mostVisible = Math.max(stats.mostVisible, result.visible);
  if (!result.same) {
    stats.mismatches++;
    console.log("mismatch", label, JSON.stringify(result));
  }
  return result;
};
const screenshot = (name) =>
  opts.out && page.screenshot({ path: path.join(opts.out, `${name}.png`) });
const waitForRebuild = () => page.waitForTimeout(1600);
const pan = async (label, dx, dy, frames) => {
  for (let i = 0; i < frames; i++) {
    await page.mouse.wheel(dx, dy);
    await check(`${label} ${i}`);
  }
};
const zoom = async (label, dy, frames) => {
  await page.keyboard.down("Control");
  for (let i = 0; i < frames; i++) {
    await page.mouse.wheel(0, dy);
    await check(`${label} ${i}`);
  }
  await page.keyboard.up("Control");
};

await page.mouse.move(720, 450);
await check("loaded");
await waitForRebuild();
await check("indexed");
await screenshot("loaded");
await pan("pan right", 80, 0, 40);
await pan("pan down", 0, 60, 30);
await zoom("zoom out", 60, 25);
await screenshot("zoomed-out");
await zoom("zoom in", -60, 40);
await pan("pan left", -120, 0, 30);

await page.evaluate(() =>
  window.h.setState({ zoom: { value: 1 }, scrollX: -1000, scrollY: -500 }),
);
await check("back at 100%");
const containers = await page.evaluate(() => {
  const { h } = window;
  const ids = h.app.visibleElements
    .filter((element) => element.type !== "text" && element.boundElements)
    .slice(0, 60)
    .map((element) => element.id);
  h.setState({
    selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
  });
  return ids;
});
await nextFrames();
await page.keyboard.press("Delete");
await check("deleted");
await pan("pan right after delete", 40, 30, 5);
const deletion = await page.evaluate((containers) => {
  const { h } = window;
  const byId = new Map(
    h.app.scene.getElementsIncludingDeleted().map((e) => [e.id, e]),
  );
  const labels = containers.flatMap((id) =>
    (byId.get(id).boundElements ?? []).map((bound) => bound.id),
  );
  const culled = new Set(h.app.visibleElements.map((element) => element.id));
  return {
    containers: containers.length,
    labelsDeleted: labels.filter((id) => byId.get(id).isDeleted).length,
    deletedStillCulledIn: [...containers, ...labels].filter((id) =>
      culled.has(id),
    ).length,
  };
}, containers);
console.log("deleted", JSON.stringify(deletion));
await screenshot("deleted");
await pan("pan back after delete", -40, -30, 5);
await waitForRebuild();
await pan("pan after delete and rebuild", 40, 30, 20);

await page.keyboard.press("Control+z");
await check("undone");
await pan("pan after undo", -40, -30, 20);
await screenshot("undone");
await waitForRebuild();
await pan("pan after undo and rebuild", 50, 0, 20);

await page.keyboard.press("r");
await page.mouse.move(600, 400);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(600 + 15 * i, 400 + 10 * i);
  await check(`draw ${i}`);
}
await page.mouse.up();
await check("drawn");
await page.keyboard.press("v");
await page.mouse.move(670, 450);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(670 + 20 * i, 450 + 5 * i);
  await check(`drag ${i}`);
}
await page.mouse.up();
await check("dragged");
await waitForRebuild();
await pan("pan after draw, drag and rebuild", 70, 40, 20);
await zoom("zoom at the end", 40, 15);
await screenshot("end");

console.log(
  `${stats.frames} frames checked, ${stats.mismatches} differ from a scan, up to ${stats.mostVisible} elements visible, ${pageErrors.length} page errors`,
);
await browser.close();
process.exit(stats.mismatches || pageErrors.length ? 1 : 0);
