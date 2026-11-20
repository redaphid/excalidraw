import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

// A finger panning a dense board, zoomed out, with the hand tool: real touch
// input through CDP (so the browser makes the pointer and touch events and
// React sees them at their real priority), timed with the browser's own
// long-animation-frame entries and their script attribution, as a phone's
// devtools would show them. The board is frames full of shapes, labels and
// strokes, loaded through the playground's restore.
const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    builds: { type: "string" },
    count: { type: "string", default: "6000" },
    zoom: { type: "string", default: "0.03" },
    tool: { type: "string", default: "hand" },
    moves: { type: "string", default: "40" },
    drags: { type: "string", default: "4" },
    runs: { type: "string", default: "2" },
    throttle: { type: "string", default: "1" },
    profile: { type: "boolean", default: false },
    // after the drags, compares what the static canvas shows with what a
    // full repaint of the same view shows
    parity: { type: "boolean", default: false },
  },
});

if (!opts.builds) {
  console.error(
    "usage: node perf-bench/finger-pan.mjs --builds base[,cand] [--count 6000] [--zoom 0.03] [--tool hand|selection] [--moves 40] [--drags 4] [--runs 2] [--throttle 1] [--profile]",
  );
  process.exit(2);
}

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 99 frames in a grid, each holding shapes with labels, strokes and text */
const board = (count) => {
  const rng = mulberry32(7);
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const elements = [];
  const FRAMES = 99;
  const perFrame = Math.floor((count - FRAMES) / FRAMES);
  let n = 0;
  const id = () => `e${++n}`;
  for (let f = 0; f < FRAMES; f++) {
    const fx = (f % 11) * 2400;
    const fy = Math.floor(f / 11) * 1800;
    const frame = {
      type: "frame",
      id: `frame${f}`,
      x: fx,
      y: fy,
      width: 2200,
      height: 1600,
      name: `Frame ${f}`,
    };
    for (let i = 0; i < perFrame; i++) {
      const x = fx + 40 + rng() * 2000;
      const y = fy + 40 + rng() * 1400;
      const kind = pick([
        "rectangle",
        "ellipse",
        "diamond",
        "freedraw",
        "text",
      ]);
      const common = {
        id: id(),
        x,
        y,
        frameId: frame.id,
        strokeColor: pick(["#1e1e1e", "#e03131", "#1971c2", "#2f9e44"]),
        backgroundColor: pick(["transparent", "#ffc9c9", "#a5d8ff"]),
        fillStyle: pick(["solid", "hachure"]),
        roughness: pick([0, 1]),
        seed: n,
      };
      if (kind === "freedraw") {
        const points = [];
        let px = 0;
        let py = 0;
        let heading = rng() * Math.PI * 2;
        for (let p = 0; p < 30; p++) {
          heading += rng() - 0.5;
          px += Math.cos(heading) * 6;
          py += Math.sin(heading) * 6;
          points.push([Math.round(px), Math.round(py)]);
        }
        elements.push({ ...common, type: "freedraw", points, pressures: [] });
      } else if (kind === "text") {
        elements.push({
          ...common,
          type: "text",
          text: `note ${n}`,
          originalText: `note ${n}`,
          fontSize: 20,
          width: 80,
          height: 25,
        });
      } else {
        const shape = { ...common, type: kind, width: 160, height: 100 };
        const label = id();
        shape.boundElements = [{ type: "text", id: label }];
        elements.push(shape, {
          id: label,
          type: "text",
          x: x + 40,
          y: y + 38,
          width: 80,
          height: 25,
          text: `label ${n}`,
          originalText: `label ${n}`,
          fontSize: 20,
          containerId: shape.id,
          textAlign: "center",
          verticalAlign: "middle",
          frameId: frame.id,
        });
      }
    }
    elements.push(frame);
  }
  return elements;
};

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const root = path.join(here, "builds");
const server = createServer((req, res) => {
  const file = path.join(
    root,
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const elements = board(Number(opts.count));
const browser = await chromium.launch({ channel: "chromium" });

const runOnce = async (build) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript(
    ({ elements, zoom }) => {
      if (!localStorage.getItem("excalidraw-playground-scene")) {
        localStorage.setItem(
          "excalidraw-playground-scene",
          JSON.stringify({
            elements,
            appState: { zoom: { value: zoom }, scrollX: 0, scrollY: 0 },
          }),
        );
      }
      // the playground saves the scene on every change; a host's onChange
      // is not what this measures
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key !== "excalidraw-playground-scene") {
          setItem.call(this, key, value);
        }
      };
      window.__loaf = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__loaf.push({
            start: entry.startTime,
            duration: entry.duration,
            blocking: entry.blockingDuration,
            render: entry.renderStart
              ? entry.startTime + entry.duration - entry.renderStart
              : 0,
            scripts: entry.scripts.map((s) => ({
              invoker: s.invoker,
              duration: s.duration,
              fn: s.sourceFunctionName,
            })),
          });
        }
      }).observe({ type: "long-animation-frame", buffered: false });
    },
    { elements, zoom: Number(opts.zoom) },
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (Number(opts.throttle) > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: Number(opts.throttle),
    });
  }
  await page.goto(
    `http://127.0.0.1:${port}/${build}/index.html?radialPalette=0&midi=0&switcher=0`,
  );
  await page.waitForFunction(
    (count) =>
      window.excalidrawAPI &&
      window.excalidrawAPI.getSceneElements().length >= count,
    elements.length - 10,
    { timeout: 120_000 },
  );
  await page.evaluate(
    ({ tool, zoom }) => {
      const api = window.excalidrawAPI;
      const all = api.getSceneElements();
      const xs = all.flatMap((e) => [e.x, e.x + e.width]);
      const ys = all.flatMap((e) => [e.y, e.y + e.height]);
      const { width, height } = api.getAppState();
      api.updateScene({
        appState: {
          zoom: { value: zoom },
          scrollX: width / 2 / zoom - (Math.min(...xs) + Math.max(...xs)) / 2,
          scrollY: height / 2 / zoom - (Math.min(...ys) + Math.max(...ys)) / 2,
        },
      });
      api.setActiveTool({ type: tool });
    },
    { tool: opts.tool, zoom: Number(opts.zoom) },
  );
  // let the bitmaps for this zoom build
  await page.waitForTimeout(opts.parity ? 15000 : 4000);
  await page.evaluate(async () => {
    // a parity check starts from a full paint with every bitmap built, so
    // a bitmap landing mid-pan cannot tell apart a moved paint from a new one
    const api = window.excalidrawAPI;
    api.updateScene({ elements: api.getSceneElements() });
    await new Promise((r) => requestAnimationFrame(() => r()));
    window.__loaf = [];
  });

  if (opts.profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
    });
  const marks = [];
  const moves = Number(opts.moves);
  for (let d = 0; d < Number(opts.drags); d++) {
    const x0 = 195;
    const y0 = 420;
    const now = () => page.evaluate(() => performance.now());
    marks.push({ kind: "down", at: await now() });
    await touch("touchStart", x0, y0);
    for (let i = 1; i <= moves; i++) {
      await touch("touchMove", x0 + i * 2 * (d % 2 ? -1 : 1), y0 + i);
      await page.waitForTimeout(16);
    }
    marks.push({ kind: "up", at: await now() });
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(500);
  let parity = null;
  if (opts.parity) {
    parity = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas.excalidraw__canvas.static");
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const pixels = () =>
        canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
          .data;
      const shown = pixels();
      const shownUrl = canvas.toDataURL();
      const api = window.excalidrawAPI;
      // a scene update repaints the whole canvas
      api.updateScene({ elements: api.getSceneElements() });
      await frame();
      await frame();
      const full = pixels();
      let differ = 0;
      let maxDelta = 0;
      for (let i = 0; i < shown.length; i += 4) {
        let delta = 0;
        for (let c = 0; c < 4; c++) {
          delta = Math.max(delta, Math.abs(shown[i + c] - full[i + c]));
        }
        if (delta > 0) {
          differ++;
          maxDelta = Math.max(maxDelta, delta);
        }
      }
      return {
        pixels: shown.length / 4,
        differ,
        maxDelta,
        shownUrl,
        fullUrl: canvas.toDataURL(),
      };
    });
  }
  let profile = null;
  if (opts.profile) {
    ({ profile } = await cdp.send("Profiler.stop"));
  }
  const loaf = await page.evaluate(() => window.__loaf);
  await context.close();
  return { loaf, profile, marks, parity };
};

const summarize = (loaf) => {
  const byInvoker = new Map();
  for (const frame of loaf) {
    for (const s of frame.scripts) {
      byInvoker.set(s.invoker, (byInvoker.get(s.invoker) ?? 0) + s.duration);
    }
  }
  return {
    frames: loaf.length,
    totalMs: Math.round(loaf.reduce((sum, f) => sum + f.duration, 0)),
    maxMs: Math.round(Math.max(0, ...loaf.map((f) => f.duration))),
    renderMs: Math.round(loaf.reduce((sum, f) => sum + f.render, 0)),
    byInvoker: [...byInvoker]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k} ${Math.round(v)}ms`),
  };
};

const out = path.join(here, "profiles");
mkdirSync(out, { recursive: true });
for (const build of opts.builds.split(",")) {
  for (let run = 0; run < Number(opts.runs); run++) {
    const { loaf, profile, parity } = await runOnce(build);
    const summary = summarize(loaf);
    console.log(
      `${build} run ${run + 1}: ${elements.length} elements, zoom ${
        opts.zoom
      }, ${opts.tool}, ${opts.drags} drags of ${
        opts.moves
      } moves: long frames ${summary.frames}, total ${summary.totalMs}ms, max ${
        summary.maxMs
      }ms, render ${summary.renderMs}ms`,
    );
    if (parity) {
      for (const which of ["shown", "full"]) {
        writeFileSync(
          path.join(out, `${build}-parity-${which}.png`),
          Buffer.from(parity[`${which}Url`].split(",")[1], "base64"),
        );
      }
      console.log(
        `  parity: ${parity.differ} of ${parity.pixels} pixels differ from a full repaint, by up to ${parity.maxDelta}`,
      );
    }
    for (const line of summary.byInvoker) {
      console.log(`  ${line}`);
    }
    if (profile) {
      const file = path.join(out, `${build}-finger-pan-${run + 1}.cpuprofile`);
      writeFileSync(file, JSON.stringify(profile));
      console.log(`  profile ${file}`);
    }
  }
}
await browser.close();
server.close();
