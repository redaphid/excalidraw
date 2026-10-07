#!/usr/bin/env node
/**
 * Pan and zoom a ~2000-element scene in the playground under a 4x CPU
 * throttle and report what a theme costs: frame times (median, p95), how
 * often getComputedStyle runs, and how many canvases (bitmap caches) get
 * created. Run it against this checkout and against another one (e.g. a
 * worktree of master) to compare.
 *
 *   node scripts/theme-screenshots/bench.mjs [--root DIR] [--theme ID] [--runs N]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer } from "vite";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((pair) => pair.trim().split(/\s+/)),
);
const root = path.resolve(
  args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const runs = Number(args.runs ?? 3);

const chromiumPath = () => {
  const dir = path.join(
    process.env.LOCALAPPDATA ?? os.homedir(),
    "ms-playwright",
  );
  const build = fs
    .readdirSync(dir)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  return path.join(dir, build, "chrome-win64", "chrome.exe");
};

const element = (i) => {
  const kinds = [
    "rectangle",
    "ellipse",
    "diamond",
    "arrow",
    "text",
    "freedraw",
  ];
  const type = kinds[i % kinds.length];
  const x = (i % 50) * 160;
  const y = Math.floor(i / 50) * 120;
  const common = {
    id: `e${i}`,
    type,
    x,
    y,
    width: 110,
    height: 70,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: i % 3 ? "transparent" : "#a5d8ff",
    fillStyle: i % 2 ? "solid" : "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: i + 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  if (type === "arrow") {
    return {
      ...common,
      points: [
        [0, 0],
        [110, 70],
      ],
      endArrowhead: "arrow",
      startArrowhead: null,
    };
  }
  if (type === "text") {
    return {
      ...common,
      text: `note ${i}`,
      originalText: `note ${i}`,
      fontSize: 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
      height: 25,
    };
  }
  if (type === "freedraw") {
    const points = Array.from({ length: 30 }, (_, k) => [
      k * 3.6,
      Math.sin(k / 3) * 30,
    ]);
    return {
      ...common,
      points,
      pressures: [],
      simulatePressure: true,
      strokeWidth: 0.25,
    };
  }
  return common;
};

const SCENE = JSON.stringify({
  elements: Array.from({ length: 2000 }, (_, i) => element(i)),
  appState: { viewBackgroundColor: "#ffffff", zoom: { value: 0.5 } },
});

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
};

const measure = async (page, gesture) => {
  await page.evaluate(() => {
    window.__bench = { frames: [], styles: 0, canvases: 0, running: true };
    let last = performance.now();
    const tick = (now) => {
      window.__bench.frames.push(now - last);
      last = now;
      if (window.__bench.running) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  await gesture();
  return page.evaluate(() => {
    window.__bench.running = false;
    const { frames, styles, canvases } = window.__bench;
    return { frames: frames.slice(2), styles, canvases };
  });
};

const server = await createServer({
  root: path.join(root, "playground"),
  configFile: path.join(root, "playground/vite.config.mts"),
  logLevel: "warn",
  server: { port: 5195, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const results = { pan: [], zoom: [], styles: 0, canvases: 0 };
try {
  for (let run = 0; run < runs; run++) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.addInitScript((scene) => {
      window.EXCALIDRAW_ASSET_PATH = `${location.origin}/`;
      localStorage.clear();
      localStorage.setItem("excalidraw-playground-scene", scene);
      const getComputedStyle = window.getComputedStyle;
      window.getComputedStyle = (...args) => {
        if (window.__bench) {
          window.__bench.styles++;
        }
        return getComputedStyle(...args);
      };
      const createElement = Document.prototype.createElement;
      Document.prototype.createElement = function (tag, ...rest) {
        if (window.__bench && String(tag).toLowerCase() === "canvas") {
          window.__bench.canvases++;
        }
        return createElement.call(this, tag, ...rest);
      };
    }, SCENE);
    const theme = args.theme
      ? `?theme=${args.theme}&switcher=0`
      : "?switcher=0";
    await page.goto(`${server.resolvedUrls.local[0]}${theme}`);
    await page.waitForSelector("canvas.interactive", { timeout: 180_000 });
    await page.waitForTimeout(2500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.mouse.move(720, 450);
    const pan = await measure(page, async () => {
      for (let i = 0; i < 90; i++) {
        await page.mouse.wheel(i < 45 ? 40 : -40, 25);
        await page.waitForTimeout(16);
      }
    });
    await page.keyboard.down("Control");
    const zoom = await measure(page, async () => {
      for (let i = 0; i < 90; i++) {
        await page.mouse.wheel(0, i < 45 ? -12 : 12);
        await page.waitForTimeout(16);
      }
    });
    await page.keyboard.up("Control");
    results.pan.push(...pan.frames);
    results.zoom.push(...zoom.frames);
    results.styles += pan.styles + zoom.styles;
    results.canvases += pan.canvases + zoom.canvases;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

const summary = (frames) =>
  `median ${percentile(frames, 50).toFixed(1)} ms, p95 ${percentile(
    frames,
    95,
  ).toFixed(1)} ms (${frames.length} frames)`;
console.log(
  `root ${root}, theme ${args.theme ?? "none"}, ${runs} runs, 4x CPU throttle`,
);
console.log(`pan:  ${summary(results.pan)}`);
console.log(`zoom: ${summary(results.zoom)}`);
console.log(`getComputedStyle calls during pan+zoom: ${results.styles}`);
console.log(`canvases created during pan+zoom: ${results.canvases}`);
