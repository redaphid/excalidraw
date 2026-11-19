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
  getSceneElements: () => readonly { id: string; version: number }[];
  updateScene: (scene: {
    elements?: readonly unknown[];
    appState?: { selectedElementIds: Record<string, true> };
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

/** a thin text the scene changes or adds to, as a remote edit or a host's patch arrives */
const CHANGING: Text = {
  id: "text-id-restless-kettle",
  y: 300,
  fontAxes: { wght: 300 },
};

const THIN_SCENE = {
  elements: [textElement(THIN), textElement(CHANGING)],
  appState: SCENE.appState,
};

/**
 * Hands the editor the scene with `text` in it, as a remote edit arrives
 * through `updateScene`: a new version of the element when the scene has it,
 * else a new element.
 */
const sendText = (page: Page, text: Text) =>
  page.evaluate((text) => {
    const api = (window as Playground).excalidrawAPI!;
    const elements = api.getSceneElements();
    const known = elements.find(({ id }) => id === text.id);
    // a new text is a copy of the first one, as the editor completed it
    const base = known ?? { ...elements[0], id: text.id, y: text.y };
    const sent = {
      ...base,
      fontAxes: text.fontAxes,
      version: base.version + 1,
      versionNonce: base.version + 7919,
    };
    api.updateScene({
      elements: [...elements.filter(({ id }) => id !== text.id), sent],
    });
  }, text);

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

test.describe("when the scene changes a text's axes", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.endsWith("desktop"),
      "measured once per browser",
    );
    await page.addInitScript(
      ([key, scene]) => localStorage.setItem(key, scene),
      [SCENE_KEY, JSON.stringify(THIN_SCENE)] as const,
    );
    await page.goto("/");
    await page.waitForFunction(
      () =>
        (window as Playground).excalidrawAPI?.getSceneElements().length === 2,
    );
    // both texts drawn in their instance before the scene changes
    await expect
      .poll(async () =>
        Math.abs(
          (await inkInBand(page, CHANGING.y)) /
            (await inkInBand(page, THIN.y)) -
            1,
        ),
      )
      .toBeLessThan(0.01);
  });

  test("redraws a shown text whose wght changes", async ({
    page,
  }, testInfo) => {
    await sendText(page, { ...CHANGING, fontAxes: { wght: 800 } });
    const ratio = async () =>
      (await inkInBand(page, CHANGING.y)) / (await inkInBand(page, THIN.y));
    try {
      await expect.poll(ratio, { timeout: 10_000 }).toBeGreaterThan(HEAVIER);
    } finally {
      report(testInfo.project.name, "patched", [
        await inkInBand(page, THIN.y),
        await inkInBand(page, CHANGING.y),
      ]);
    }
  });

  test("draws a text that arrives at a new wght in it", async ({
    page,
  }, testInfo) => {
    const arriving: Text = {
      id: "text-id-late-albatross",
      y: 500,
      fontAxes: { wght: 800 },
    };
    await sendText(page, arriving);
    const ratio = async () =>
      (await inkInBand(page, arriving.y)) / (await inkInBand(page, THIN.y));
    try {
      await expect.poll(ratio, { timeout: 10_000 }).toBeGreaterThan(HEAVIER);
    } finally {
      report(testInfo.project.name, "arrived", [
        await inkInBand(page, THIN.y),
        await inkInBand(page, arriving.y),
      ]);
    }
  });
});
