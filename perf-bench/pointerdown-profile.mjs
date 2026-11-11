import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

// CPU-profiles the editor's pointerdown handler on a board of N rectangles
// and prints where its time goes, per click. Only samples under
// handleCanvasPointerDown count, found by its line in an unminified build.
const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    build: { type: "string" },
    count: { type: "string", default: "50000" },
    tool: { type: "string", default: "selection" },
    repeats: { type: "string", default: "20" },
    top: { type: "string", default: "25" },
    out: { type: "string" },
  },
});

if (!opts.build) {
  console.error(
    "usage: node perf-bench/pointerdown-profile.mjs --build <name> [--count 50000] [--tool selection] [--repeats 20] [--top 25] [--out file.cpuprofile]; build with --no-minify",
  );
  process.exit(2);
}
const repeats = Number(opts.repeats);

const root = path.join(here, "builds");
const assets = path.join(root, opts.build, "assets");
const bundle = readdirSync(assets).find((file) => /^index-.*\.js$/.test(file));
const handlerLine = readFileSync(path.join(assets, bundle), "utf8")
  .split("\n")
  .findIndex((line) =>
    line.includes('__publicField(this, "handleCanvasPointerDown"'),
  );
if (handlerLine < 0) {
  console.error(`no handleCanvasPointerDown in ${bundle}; build with --no-minify`);
  process.exit(2);
}

const server = createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
    path.extname(file)
  ];
  res.writeHead(200, type ? { "content-type": type } : {});
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({ channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 50 });
let profile;
await page.exposeFunction("profilerHook", async (phase) => {
  if (phase === "start") {
    await cdp.send("Profiler.start");
  } else {
    ({ profile } = await cdp.send("Profiler.stop"));
  }
});
await page.goto(`http://127.0.0.1:${server.address().port}/${opts.build}/index.html`);
await page.waitForFunction(() => window.excalidrawAPI, null, { timeout: 120_000 });

// the same board and clicks as pointerdown.mjs
const timings = await page.evaluate(
  async ({ count, tool, repeats }) => {
    const api = window.excalidrawAPI;
    const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const index = (i) =>
      `c${DIGITS[Math.floor(i / 3844) % 62]}${DIGITS[Math.floor(i / 62) % 62]}${DIGITS[i % 62]}`;
    const columns = Math.ceil(Math.sqrt(count));
    const elements = Array.from({ length: count }, (_, i) => ({
      id: `bench-${i}`,
      type: "rectangle",
      x: 3000 + (i % columns) * 60,
      y: 3000 + Math.floor(i / columns) * 60,
      width: 40,
      height: 30,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: index(i),
      roundness: null,
      seed: i + 1,
      version: 1,
      versionNonce: i + 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    }));
    api.updateScene({ elements, captureUpdate: "NEVER" });
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame();
    await frame();
    const canvas = document.querySelector("canvas.interactive");
    const rect = canvas.getBoundingClientRect();
    const fire = (type, x, y) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          pressure: type === "pointerup" ? 0 : 0.5,
        }),
      );
    const samples = [];
    await window.profilerHook("start");
    for (let r = 0; r < repeats; r++) {
      // a shape click without a drag hands the editor back to selection,
      // which can land a few frames late
      for (let wait = 0; api.getAppState().activeTool.type !== tool; wait++) {
        if (wait === 10) {
          throw new Error(`${tool} is not the active tool`);
        }
        api.setActiveTool({ type: tool });
        await frame();
      }
      const x = rect.left + rect.width * (0.3 + 0.02 * r);
      const y = rect.top + rect.height * 0.5;
      const start = performance.now();
      fire("pointerdown", x, y);
      samples.push(performance.now() - start);
      fire("pointerup", x, y);
      await frame();
      await frame();
    }
    await window.profilerHook("stop");
    return samples;
  },
  { count: Number(opts.count), tool: opts.tool, repeats },
);
await browser.close();
server.close();

if (opts.out) {
  writeFileSync(opts.out, JSON.stringify(profile));
}

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) {
  for (const child of node.children ?? []) {
    parent.set(child, node.id);
  }
}
const label = ({ callFrame }) =>
  `${callFrame.functionName || "(anonymous)"} ${path.basename(callFrame.url)}:${callFrame.lineNumber + 1}`;
const isHandler = ({ callFrame }) =>
  callFrame.url.endsWith(bundle) && callFrame.lineNumber === handlerLine;

const self = new Map();
const total = new Map();
let inHandler = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
  const stack = [];
  for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
    stack.push(nodes.get(id));
  }
  if (!stack.some(isHandler)) {
    continue;
  }
  inHandler += ms;
  self.set(label(stack[0]), (self.get(label(stack[0])) ?? 0) + ms);
  for (const frame of new Set(stack.map(label))) {
    total.set(frame, (total.get(frame) ?? 0) + ms);
  }
}

const perClick = (ms) => (ms / repeats).toFixed(2).padStart(8);
const median = [...timings].sort((a, b) => a - b)[timings.length >> 1];
console.log(
  `${opts.build} ${opts.tool} ${opts.count}: median pointerdown ${median.toFixed(1)} ms, ${perClick(inHandler).trim()} ms/click sampled in the handler`,
);
for (const [title, byFrame] of [
  ["self", self],
  ["total", total],
]) {
  console.log(`-- ${title} ms/click`);
  for (const [frame, ms] of [...byFrame]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(opts.top))) {
    console.log(`${perClick(ms)}  ${frame}`);
  }
}
