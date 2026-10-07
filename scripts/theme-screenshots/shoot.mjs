#!/usr/bin/env node
/**
 * Screenshots every playground theme in a populated scene, across viewports
 * and UI states, then optionally builds contact sheets or diffs two runs.
 *
 *   node scripts/theme-screenshots/shoot.mjs [options]
 *
 *   --themes a,b        theme ids (default: "default" plus playground/themes/*.css)
 *   --viewports a,b     desktop, tablet, phone (default: all)
 *   --states a,b        canvas, selected, colorpicker, menu, dialog (default: all)
 *   --out DIR           output root (default: theme-screenshots/shots)
 *   --contact STATE     after shooting, write one contact sheet per viewport
 *                       from STATE (e.g. selected) to OUT/contact-<viewport>.png
 *   --no-shoot          skip shooting (use with --contact or --compare)
 *   --compare A B       count differing pixels between same-named PNGs in two
 *                       output roots; exits 1 if any differ
 *
 * Chromium: the newest %LOCALAPPDATA%/ms-playwright/chromium-* build, or
 * CHROMIUM_PATH. Nothing is downloaded.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer } from "vite";

import { buildScene } from "./scene.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tablet: {
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

const setAppState = (page, appState) =>
  page.evaluate((appState) => {
    window.excalidrawAPI.updateScene({ appState });
  }, appState);

const selectResearch = (page) =>
  setAppState(page, { selectedElementIds: { research: true } });

const STATES = {
  canvas: async () => {},
  selected: selectResearch,
  colorpicker: async (page) => {
    await selectResearch(page);
    await setAppState(page, { openPopup: "elementStroke" });
  },
  menu: async (page) => {
    await page.click('[data-testid="main-menu-trigger"]');
  },
  dialog: (page) => setAppState(page, { openDialog: { name: "help" } }),
};

const parseArgs = (argv) => {
  const args = { shoot: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === "--themes") {
      args.themes = value().split(",");
    } else if (flag === "--viewports") {
      args.viewports = value().split(",");
    } else if (flag === "--states") {
      args.states = value().split(",");
    } else if (flag === "--out") {
      args.out = path.resolve(value());
    } else if (flag === "--contact") {
      args.contact = value();
    } else if (flag === "--no-shoot") {
      args.shoot = false;
    } else if (flag === "--compare") {
      args.compare = [path.resolve(value()), path.resolve(value())];
      args.shoot = false;
    } else {
      throw new Error(`unknown flag ${flag}`);
    }
  }
  return args;
};

const listThemes = () => [
  "default",
  ...fs
    .readdirSync(path.join(root, "playground/themes"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => entry.name.replace(/\.css$/, ""))
    .sort(),
];

const findChromium = () => {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }
  const dir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const builds = fs
    .readdirSync(dir)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const exe = path.join(dir, build, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) {
      return exe;
    }
  }
  throw new Error(`no chromium under ${dir}; set CHROMIUM_PATH`);
};

const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        document.fonts.ready.then(() =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 350)),
          ),
        ),
      ),
  );

// room for the properties panel, which covers the canvas's left edge
const LEFT_PANEL = { desktop: 240, tablet: 240, phone: 0 };

const shootOne = async (context, baseUrl, viewport, theme, state, file) => {
  const page = await context.newPage();
  const scene = JSON.stringify(buildScene());
  await page.addInitScript((scene) => {
    // the dev server serves fonts from absolute /@fs/ paths, which the font
    // loader resolves only against EXCALIDRAW_ASSET_PATH
    window.EXCALIDRAW_ASSET_PATH = `${location.origin}/`;
    localStorage.clear();
    localStorage.setItem("excalidraw-playground-scene", scene);
  }, scene);
  await page.goto(`${baseUrl}?theme=${theme}&switcher=0`);
  await page.waitForFunction(() => !!window.excalidrawAPI, null, {
    timeout: 180_000,
  });
  await page.waitForFunction(
    () => window.excalidrawAPI.getSceneElements().length > 0,
  );
  await settle(page);
  await page.evaluate((leftPanel) => {
    const api = window.excalidrawAPI;
    const elements = api.getSceneElements();
    const minX = Math.min(...elements.map((el) => el.x));
    const minY = Math.min(...elements.map((el) => el.y));
    const maxX = Math.max(...elements.map((el) => el.x + el.width));
    const maxY = Math.max(...elements.map((el) => el.y + el.height));
    api.setViewport({
      target: {
        x: minX - leftPanel,
        y: minY - 40,
        width: maxX - minX + leftPanel + 40,
        height: maxY - minY + 80,
      },
      fit: "scale-down",
    });
  }, LEFT_PANEL[viewport]);
  await settle(page);
  await STATES[state](page);
  await page.mouse.move(-10, -10);
  await settle(page);
  await page.screenshot({ path: file });
  await page.close();
};

const shoot = async (args) => {
  const server = await createServer({
    configFile: path.join(root, "playground/vite.config.mts"),
    logLevel: "warn",
    server: { port: 5190, strictPort: false },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: findChromium() });
  try {
    for (const viewport of args.viewports) {
      const context = await browser.newContext(VIEWPORTS[viewport]);
      for (const theme of args.themes) {
        fs.mkdirSync(path.join(args.out, theme), { recursive: true });
        for (const state of args.states) {
          const file = path.join(args.out, theme, `${viewport}-${state}.png`);
          await shootOne(context, baseUrl, viewport, theme, state, file);
          console.log(file);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

const contactSheet = async (args) => {
  const browser = await chromium.launch({ executablePath: findChromium() });
  try {
    for (const viewport of args.viewports) {
      const cells = args.themes
        .map((theme) => {
          const file = path.join(
            args.out,
            theme,
            `${viewport}-${args.contact}.png`,
          );
          if (!fs.existsSync(file)) {
            return "";
          }
          const src = `data:image/png;base64,${fs
            .readFileSync(file)
            .toString("base64")}`;
          return `<figure><img src="${src}"><figcaption>${theme}</figcaption></figure>`;
        })
        .join("");
      const columns = viewport === "phone" ? 6 : 3;
      const cellWidth = viewport === "phone" ? 300 : 620;
      const page = await browser.newPage({
        viewport: { width: columns * (cellWidth + 24) + 24, height: 400 },
      });
      await page.setContent(`<!doctype html><style>
        body { margin: 0; padding: 12px; background: #16161a; font: 600 15px system-ui, sans-serif; color: #e8e8ee; }
        main { display: grid; grid-template-columns: repeat(${columns}, ${cellWidth}px); gap: 24px; padding: 12px; }
        figure { margin: 0; }
        img { width: 100%; display: block; border-radius: 6px; box-shadow: 0 0 0 1px #333; }
        figcaption { padding: 8px 2px 0; letter-spacing: 0.02em; }
      </style><main>${cells}</main>`);
      await page.evaluate(() =>
        Promise.all([...document.images].map((img) => img.decode())),
      );
      const file = path.join(args.out, `contact-${viewport}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      console.log(file);
    }
  } finally {
    await browser.close();
  }
};

const listPngs = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((file) => file.endsWith(".png") && !file.startsWith("contact-"))
    .sort();

const compare = async ([a, b]) => {
  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await browser.newPage();
  let failures = 0;
  try {
    for (const file of listPngs(a)) {
      const other = path.join(b, file);
      if (!fs.existsSync(other)) {
        console.log(`MISSING ${file}`);
        failures++;
        continue;
      }
      const toUrl = (p) =>
        `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
      const diff = await page.evaluate(
        async ([left, right]) => {
          const load = async (src) => {
            const img = new Image();
            img.src = src;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const context = canvas.getContext("2d");
            context.drawImage(img, 0, 0);
            return context.getImageData(0, 0, img.width, img.height);
          };
          const [x, y] = await Promise.all([load(left), load(right)]);
          if (x.width !== y.width || x.height !== y.height) {
            return -1;
          }
          let count = 0;
          for (let i = 0; i < x.data.length; i += 4) {
            if (
              x.data[i] !== y.data[i] ||
              x.data[i + 1] !== y.data[i + 1] ||
              x.data[i + 2] !== y.data[i + 2] ||
              x.data[i + 3] !== y.data[i + 3]
            ) {
              count++;
            }
          }
          return count;
        },
        [toUrl(path.join(a, file)), toUrl(other)],
      );
      console.log(`${diff === 0 ? "SAME" : "DIFF"} ${file} ${diff} px`);
      if (diff !== 0) {
        failures++;
      }
    }
  } finally {
    await browser.close();
  }
  return failures;
};

const args = parseArgs(process.argv.slice(2));
if (args.shoot || args.contact) {
  args.themes ??= listThemes();
}
args.viewports ??= Object.keys(VIEWPORTS);
args.states ??= Object.keys(STATES);
args.out ??= path.join(root, "theme-screenshots/shots");

if (args.shoot) {
  await shoot(args);
}
if (args.contact) {
  await contactSheet(args);
}
if (args.compare) {
  process.exitCode = (await compare(args.compare)) ? 1 : 0;
}
