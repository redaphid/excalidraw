#!/usr/bin/env node
/**
 * Screenshots every playground theme in a populated scene, across viewports
 * and UI states, then optionally records pen videos, builds contact sheets
 * or diffs two runs.
 *
 *   node scripts/theme-screenshots/shoot.mjs [options]
 *
 *   --themes a,b        theme ids (default: "default" plus themes/index.json)
 *   --viewports a,b     desktop, tablet, phone (default: all)
 *   --states a,b        canvas, selected, colorpicker, menu, dialog, pen
 *                       (default: all; pen also writes a 2.5x close-up, penzoom)
 *   --browser NAME      chromium (default), firefox or webkit
 *   --root DIR          the checkout whose playground to serve (default: this
 *                       one), e.g. a worktree of master for a before/after diff
 *   --out DIR           output root (default: theme-screenshots/shots)
 *   --video             also record the pen strokes live, desktop and phone,
 *                       to OUT/<theme>/<viewport>-pen.webm (chromium)
 *   --contact STATE     after shooting, write one contact sheet per viewport
 *                       from STATE (e.g. selected) to OUT/contact-<viewport>.png
 *   --sheet             after shooting, tile every shot of each theme into
 *                       OUT/<theme>/sheet.png: one image to read per theme
 *   --no-shoot          skip the screenshots (use with --video or --contact)
 *   --compare A B       count differing pixels between same-named PNGs in two
 *                       output roots; exits 1 if any differ
 *
 * Browsers are the newest %LOCALAPPDATA%/ms-playwright builds (or
 * CHROMIUM_PATH / FIREFOX_PATH / WEBKIT_PATH). Nothing is downloaded.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright-core";
import { createServer } from "vite";

import { PEN_BOX, penStrokes } from "./pen.mjs";
import { buildScene } from "./scene.mjs";

let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

const BROWSERS = {
  chromium: {
    type: chromium,
    dir: /^chromium-\d+$/,
    exe: "chrome-win64/chrome.exe",
    env: "CHROMIUM_PATH",
  },
  firefox: {
    type: firefox,
    dir: /^firefox-\d+$/,
    exe: "firefox/firefox.exe",
    env: "FIREFOX_PATH",
  },
  webkit: {
    type: webkit,
    dir: /^webkit-\d+$/,
    exe: "Playwright.exe",
    env: "WEBKIT_PATH",
  },
};

const msPlaywright = path.join(
  process.env.LOCALAPPDATA ?? os.homedir(),
  "ms-playwright",
);

const newestBuild = (pattern, exe) => {
  const builds = fs
    .readdirSync(msPlaywright)
    .filter((name) => pattern.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const file = path.join(msPlaywright, build, exe);
    if (fs.existsSync(file)) {
      return file;
    }
  }
  throw new Error(`no ${exe} under ${msPlaywright}`);
};

const launch = (name) => {
  const browser = BROWSERS[name];
  return browser.type.launch({
    executablePath:
      process.env[browser.env] ?? newestBuild(browser.dir, browser.exe),
  });
};

const setAppState = (page, appState) =>
  page.evaluate((appState) => {
    window.excalidrawAPI.updateScene({ appState });
  }, appState);

const selectResearch = (page) =>
  setAppState(page, { selectedElementIds: { research: true } });

/** where the pen box lands on screen, scaled to fit the viewport */
const penPlacement = ({ width, height }) => {
  const scale = Math.min(1.2, (width - 48) / PEN_BOX.width);
  return {
    scale,
    x: (width - PEN_BOX.width * scale) / 2,
    y: height * 0.46 - (PEN_BOX.height * scale) / 2,
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** draws the pen strokes with CDP pen events, so pressure is real */
const drawPen = async (page, { realtime }) => {
  const cdp = await page.context().newCDPSession(page);
  const { scale, x, y } = penPlacement(page.viewportSize());
  await page.evaluate(() =>
    window.excalidrawAPI.setActiveTool({ type: "freedraw" }),
  );
  // a stroke sent before the tool commits becomes a selection drag
  await page.waitForFunction(
    () => window.excalidrawAPI.getAppState().activeTool.type === "freedraw",
  );
  await settle(page);
  const send = (type, point, buttons) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: x + point.x * scale,
      y: y + point.y * scale,
      button: "left",
      buttons,
      clickCount: type === "mouseMoved" ? 0 : 1,
      pointerType: "pen",
      force: point.pressure,
    });
  for (const stroke of penStrokes()) {
    await send("mousePressed", stroke[0], 1);
    for (const point of stroke.slice(1)) {
      if (realtime) {
        await sleep(point.dt);
      }
      await send("mouseMoved", point, 1);
    }
    await send("mouseReleased", stroke[stroke.length - 1], 0);
    if (realtime) {
      await sleep(90);
    }
  }
  await page.evaluate(() => {
    const api = window.excalidrawAPI;
    api.setActiveTool({ type: "selection" });
    api.updateScene({ appState: { selectedElementIds: {} } });
  });
  await cdp.detach();
  const drawn = await page.evaluate(
    () => window.excalidrawAPI.getSceneElements().length,
  );
  if (drawn !== penStrokes().length) {
    throw new Error(`drew ${penStrokes().length} strokes, got ${drawn}`);
  }
};

/** 2.5x onto the handwriting, the first stroke */
const zoomOnHandwriting = (page) =>
  page.evaluate((viewport) => {
    const api = window.excalidrawAPI;
    const [word] = api.getSceneElements();
    // freedraw points are relative to the first one and can go negative
    const xs = word.points.map(([x]) => word.x + x);
    const ys = word.points.map(([, y]) => word.y + y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // 2.5x, or less where the word would not fit (phones)
    const zoom = Math.min(
      2.5,
      viewport.width / ((Math.max(...xs) - Math.min(...xs)) * 1.15),
    );
    const width = viewport.width / zoom;
    const height = viewport.height / zoom;
    api.setViewport({
      target: { x: cx - width / 2, y: cy - height / 2, width, height },
      fit: "contain",
    });
  }, page.viewportSize());

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
  pen: (page) => drawPen(page, { realtime: false }),
};

const parseArgs = (argv) => {
  const args = { shoot: true, browser: "chromium" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === "--themes") {
      args.themes = value().split(",");
    } else if (flag === "--viewports") {
      args.viewports = value().split(",");
    } else if (flag === "--states") {
      args.states = value().split(",");
    } else if (flag === "--browser") {
      args.browser = value();
    } else if (flag === "--root") {
      args.root = path.resolve(value());
    } else if (flag === "--out") {
      args.out = path.resolve(value());
    } else if (flag === "--video") {
      args.video = true;
    } else if (flag === "--contact") {
      args.contact = value();
    } else if (flag === "--sheet") {
      args.sheet = true;
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
  ...JSON.parse(
    fs.readFileSync(
      path.join(root, "packages/excalidraw/themes/index.json"),
      "utf8",
    ),
  )
    .themes.map(({ name }) => name)
    .sort(),
];

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
const LEFT_PANEL = { desktop: 220, tablet: 220, phone: 0 };

const openTheme = async (context, baseUrl, theme, scene) => {
  const page = await context.newPage();
  await page.addInitScript((scene) => {
    // the dev server serves fonts from absolute /@fs/ paths, which the font
    // loader resolves only against EXCALIDRAW_ASSET_PATH
    window.EXCALIDRAW_ASSET_PATH = `${location.origin}/`;
    localStorage.clear();
    localStorage.setItem("excalidraw-playground-scene", scene);
  }, scene);
  await page.goto(`${baseUrl}?theme=${theme}&switcher=0`, {
    timeout: 600_000,
  });
  await page.waitForFunction(() => !!window.excalidrawAPI, null, {
    timeout: 600_000,
  });
  await page.waitForFunction(
    () => !window.excalidrawAPI.getAppState().isLoading,
  );
  return page;
};

const BLANK_SCENE = JSON.stringify({
  elements: [],
  appState: { gridModeEnabled: true, viewBackgroundColor: "#ffffff" },
});

/** the new-element defaults and swatches the theme gave a blank editor */
const readStyle = async (context, baseUrl, theme) => {
  const page = await openTheme(context, baseUrl, theme, BLANK_SCENE);
  await settle(page);
  const style = await page.evaluate(() => {
    const state = window.excalidrawAPI.getAppState();
    return {
      ...Object.fromEntries(
        Object.entries(state).filter(([key]) => key.startsWith("currentItem")),
      ),
      strokePicks: state.colorTopPicks.elementStroke,
      backgroundPicks: state.colorTopPicks.elementBackground,
    };
  });
  await page.close();
  return style;
};

const fitScene = (page, viewport) =>
  page.evaluate((leftPanel) => {
    const api = window.excalidrawAPI;
    const elements = api.getSceneElements();
    const minX = Math.min(...elements.map((el) => el.x));
    const minY = Math.min(...elements.map((el) => el.y));
    const maxX = Math.max(...elements.map((el) => el.x + el.width));
    const maxY = Math.max(...elements.map((el) => el.y + el.height));
    api.setViewport({
      target: {
        x: minX - leftPanel - 20,
        y: minY - 40,
        width: maxX - minX + leftPanel + 40,
        height: maxY - minY + 80,
      },
      fit: "scale-down",
    });
  }, LEFT_PANEL[viewport]);

const capture = async (page, file) => {
  await page.mouse.move(-10, -10);
  await settle(page);
  await page.screenshot({ path: file });
  console.log(file);
};

const shootOne = async (
  context,
  baseUrl,
  viewport,
  theme,
  style,
  state,
  dir,
) => {
  const pen = state === "pen";
  const page = await openTheme(
    context,
    baseUrl,
    theme,
    pen
      ? BLANK_SCENE
      : JSON.stringify(buildScene(style, { stacked: viewport === "phone" })),
  );
  await settle(page);
  if (!pen) {
    await fitScene(page, viewport);
    await settle(page);
  }
  await STATES[state](page);
  if (pen) {
    // fresh strokes are redrawn crisp from cache a moment after drawing
    await page.waitForTimeout(1500);
  }
  await capture(page, path.join(dir, `${viewport}-${state}.png`));
  if (pen) {
    await zoomOnHandwriting(page);
    // after a zoom the editor redraws cached strokes crisp, a moment later
    await page.waitForTimeout(1500);
    await capture(page, path.join(dir, `${viewport}-penzoom.png`));
  }
  await page.close();
};

const withServer = async (run) => {
  const server = await createServer({
    configFile: path.join(root, "playground/vite.config.mts"),
    logLevel: "warn",
    // a source edit mid-run must not reload the pages being shot
    server: { port: 5190, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  try {
    await run(server.resolvedUrls.local[0]);
  } finally {
    await server.close();
  }
};

const shoot = (args) =>
  withServer(async (baseUrl) => {
    const browser = await launch(args.browser);
    const styles = new Map();
    try {
      for (const viewport of args.viewports) {
        const context = await browser.newContext(VIEWPORTS[viewport]);
        for (const theme of args.themes) {
          const dir = path.join(args.out, theme);
          fs.mkdirSync(dir, { recursive: true });
          if (!styles.has(theme)) {
            styles.set(theme, await readStyle(context, baseUrl, theme));
          }
          for (const state of args.states) {
            await shootOne(
              context,
              baseUrl,
              viewport,
              theme,
              styles.get(theme),
              state,
              dir,
            );
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });

const VIDEO_VIEWPORTS = ["desktop", "phone"];

/** the pen strokes drawn live, trimmed to start just before the first one */
const recordPen = (args) =>
  withServer(async (baseUrl) => {
    const browser = await launch("chromium");
    const ffmpeg = newestBuild(/^ffmpeg-\d+$/, "ffmpeg-win64.exe");
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), "theme-pen-"));
    try {
      for (const viewport of VIDEO_VIEWPORTS.filter((v) =>
        args.viewports.includes(v),
      )) {
        for (const theme of args.themes) {
          const { viewport: size } = VIEWPORTS[viewport];
          const context = await browser.newContext({
            ...VIEWPORTS[viewport],
            recordVideo: { dir: raw, size },
          });
          const started = Date.now();
          const page = await openTheme(context, baseUrl, theme, BLANK_SCENE);
          await settle(page);
          await page.mouse.move(-10, -10);
          const offset = (Date.now() - started) / 1000;
          await drawPen(page, { realtime: true });
          await sleep(900);
          const video = page.video();
          await context.close();
          const file = path.join(args.out, theme, `${viewport}-pen.webm`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          execFileSync(ffmpeg, [
            "-y",
            "-loglevel",
            "error",
            "-ss",
            String(Math.max(0, offset - 0.3)),
            "-i",
            await video.path(),
            "-c:v",
            "libvpx",
            "-b:v",
            "2M",
            "-an",
            file,
          ]);
          console.log(file);
        }
      }
    } finally {
      await browser.close();
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });

const contactSheet = async (args) => {
  const browser = await launch("chromium");
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
      const columns =
        viewport === "desktop" ? 3 : viewport === "tablet" ? 5 : 6;
      const cellWidth =
        viewport === "desktop" ? 620 : viewport === "tablet" ? 360 : 300;
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

/** every shot of a theme on one page, desktop and tablet first, phones after */
const themeSheets = async (args) => {
  const browser = await launch("chromium");
  try {
    for (const theme of args.themes) {
      const dir = path.join(args.out, theme);
      if (!fs.existsSync(dir)) {
        continue;
      }
      const shots = fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".png") && file !== "sheet.png")
        .sort(
          (a, b) =>
            Number(a.startsWith("phone")) - Number(b.startsWith("phone")) ||
            a.localeCompare(b),
        );
      const cells = shots
        .map((file) => {
          const src = `data:image/png;base64,${fs
            .readFileSync(path.join(dir, file))
            .toString("base64")}`;
          return `<figure class="${
            file.startsWith("phone") ? "phone" : "wide"
          }"><img src="${src}"><figcaption>${file}</figcaption></figure>`;
        })
        .join("");
      const page = await browser.newPage({
        viewport: { width: 1920, height: 400 },
      });
      await page.setContent(`<!doctype html><style>
        body { margin: 0; padding: 12px; background: #16161a; font: 600 13px system-ui, sans-serif; color: #e8e8ee; }
        main { display: flex; flex-wrap: wrap; gap: 14px; }
        figure { margin: 0; }
        figure.wide { width: 620px; }
        figure.phone { width: 300px; }
        img { width: 100%; display: block; box-shadow: 0 0 0 1px #333; }
        figcaption { padding: 4px 2px 0; }
      </style><main>${cells}</main>`);
      await page.evaluate(() =>
        Promise.all([...document.images].map((img) => img.decode())),
      );
      const file = path.join(dir, "sheet.png");
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
    .filter(
      (file) =>
        file.endsWith(".png") &&
        !file.startsWith("contact-") &&
        !file.endsWith("sheet.png"),
    )
    .sort();

const compare = async ([a, b]) => {
  const browser = await launch("chromium");
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
root = args.root ?? root;
args.viewports ??= Object.keys(VIEWPORTS);
args.states ??= Object.keys(STATES);
args.out ??= path.join(root, "theme-screenshots/shots");
if (args.shoot || args.contact || args.video || args.sheet) {
  args.themes ??= listThemes();
}

if (args.shoot) {
  await shoot(args);
}
if (args.video) {
  await recordPen(args);
}
if (args.contact) {
  await contactSheet(args);
}
if (args.sheet) {
  await themeSheets(args);
}
if (args.compare) {
  process.exitCode = (await compare(args.compare)) ? 1 : 0;
}
