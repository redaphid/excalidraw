import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const SCENE_KEY = "excalidraw-playground-scene";
const SHANTELL_SANS = 11;
const FONT_SIZE = 56;
const WORDS = "Thin or heavy";
/** how much more ink the heavy words must draw than the thin ones */
const HEAVIER = 1.5;

type Axes = Record<string, number>;
type Text = { id: string; y: number; fontAxes: Axes };

const THIN: Text = {
  id: "text-id-whispering-heron",
  y: 100,
  fontAxes: { wght: 300 },
};
const HEAVY: Text = {
  id: "text-id-thundering-ox",
  y: 300,
  fontAxes: { wght: 800 },
};

const textElement = ({ id, y, fontAxes }: Text) => ({
  id,
  type: "text",
  x: 100,
  y,
  width: 420,
  height: FONT_SIZE * 1.25,
  text: WORDS,
  originalText: WORDS,
  fontSize: FONT_SIZE,
  fontFamily: SHANTELL_SANS,
  fontAxes,
  lineHeight: 1.25,
  textAlign: "left",
  verticalAlign: "top",
  autoResize: true,
});

const SCENE = {
  elements: [textElement(THIN), textElement(HEAVY)],
  appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 },
};

type Api = {
  getSceneElements: () => readonly { id: string }[];
  updateScene: (scene: {
    appState: { selectedElementIds: Record<string, true> };
  }) => void;
};

type Playground = Window & {
  excalidrawAPI?: Api;
  exportToSvg?: (options: {
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: null;
  }) => Promise<SVGSVGElement>;
};

/** pixels of the static canvas, in a band of CSS pixels from `top`, that differ from the paper */
const inkInBand = (page: Page, top: number) =>
  page.evaluate(
    ([top, height]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "canvas.excalidraw__canvas.static",
      )!;
      const scale = canvas.width / canvas.clientWidth;
      const context = canvas.getContext("2d")!;
      const paper = context.getImageData(0, 0, 1, 1).data;
      const { data } = context.getImageData(
        0,
        Math.round(top * scale),
        canvas.width,
        Math.round(height * scale),
      );
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i] !== paper[0] ||
          data[i + 1] !== paper[1] ||
          data[i + 2] !== paper[2]
        ) {
          inked++;
        }
      }
      return inked;
    },
    [top - 10, FONT_SIZE * 1.25 + 20] as const,
  );

const canvasHeavier = async (page: Page) =>
  (await inkInBand(page, HEAVY.y)) / (await inkInBand(page, THIN.y));

/** opaque pixels of one text exported as SVG with its fonts, drawn as an image */
const svgInk = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const playground = window as Playground;
    const element = playground
      .excalidrawAPI!.getSceneElements()
      .find((element) => element.id === id)!;
    const svg = await playground.exportToSvg!({
      elements: [element],
      appState: { exportBackground: false },
      files: null,
    });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        new XMLSerializer().serializeToString(svg),
      )}`;
    });
    // an SVG image may lay its fonts out after load
    await new Promise((resolve) => setTimeout(resolve, 300));
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let inked = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        inked++;
      }
    }
    return inked;
  }, id);

const savedAxes = (page: Page, id: string) =>
  page.evaluate(
    ([key, id]) =>
      (
        JSON.parse(localStorage.getItem(key) ?? "null")?.elements as
          | { id: string; text: string; fontAxes?: Axes }[]
          | undefined
      )?.find((element) => element.id === id),
    [SCENE_KEY, id] as const,
  );

const report = (project: string, what: string, [thin, heavy]: number[]) =>
  console.info(
    `font axes, ${project}, ${what}: wght 300 ${thin} px, wght 800 ${heavy} px, ${(
      heavy / thin
    ).toFixed(2)}x`,
  );

test.describe("text with font axes", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.endsWith("desktop"),
      "measured once per browser",
    );
    await page.addInitScript(
      ([key, scene]) => localStorage.setItem(key, scene),
      [SCENE_KEY, JSON.stringify(SCENE)] as const,
    );
    await page.goto("/");
    await page.waitForFunction(
      () =>
        (window as Playground).excalidrawAPI?.getSceneElements().length === 2,
    );
  });

  test("draws wght 800 heavier than wght 300", async ({ page }, testInfo) => {
    try {
      await expect
        .poll(() => canvasHeavier(page), { timeout: 10_000 })
        .toBeGreaterThan(HEAVIER);
    } finally {
      report(testInfo.project.name, "canvas", [
        await inkInBand(page, THIN.y),
        await inkInBand(page, HEAVY.y),
      ]);
    }
  });

  test("keeps its axes through an edit, and still draws them", async ({
    page,
  }) => {
    await page.evaluate(
      (id) =>
        (window as Playground).excalidrawAPI!.updateScene({
          appState: { selectedElementIds: { [id]: true } },
        }),
      HEAVY.id,
    );
    await page.locator(".excalidraw-container").focus();
    await page.keyboard.press("Enter");
    const editor = page.locator(".excalidraw-wysiwyg");
    await expect(editor).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    await expect
      .poll(() => savedAxes(page, HEAVY.id))
      .toMatchObject({ text: `${WORDS}!`, fontAxes: HEAVY.fontAxes });
    await expect
      .poll(() => canvasHeavier(page), { timeout: 10_000 })
      .toBeGreaterThan(HEAVIER);
  });

  test("exports wght 800 heavier than wght 300 to SVG", async ({
    page,
  }, testInfo) => {
    const thin = await svgInk(page, THIN.id);
    const heavy = await svgInk(page, HEAVY.id);
    report(testInfo.project.name, "svg", [thin, heavy]);
    expect(heavy / thin).toBeGreaterThan(HEAVIER);
  });
});
