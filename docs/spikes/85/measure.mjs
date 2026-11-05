// Spike #85: screenshots and main-thread ms per pan frame for each backdrop.
// node docs/spikes/85/measure.mjs <playground build dir> [--runs 5] [--shots]

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "5" },
    frames: { type: "string", default: "120" },
    throttle: { type: "string", default: "1" },
    shots: { type: "boolean", default: false },
    channel: { type: "string", default: "chrome" },
  },
});
const root = path.resolve(positionals[0]);
const VARIANTS = ["none", "css", "css-lean", "canvas"];
const ZOOMS = [1, 100, 1e5, 1e6];
const CENTER = { x: 1234.5678, y: 987.654 };
const VIEW = { width: 1440, height: 900 };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (file.endsWith(path.sep)) file = path.join(file, "index.html");
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: opts.channel });
console.log(`chrome ${browser.version()}, cpu throttle ${opts.throttle}x`);

const open = async (variant) => {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${origin}/?backdrop=${variant}&switcher=0`);
  await page.waitForFunction(() => window.excalidrawAPI?.getAppState);
  await page.waitForTimeout(500);
  return { context, page };
};

const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

const lookAt = async (page, zoom) => {
  for (const nudge of [1e-3, 0]) {
    await page.evaluate(
      ({ zoom, c, v, nudge }) =>
        window.excalidrawAPI.updateScene({
          appState: {
            zoom: { value: zoom },
            scrollX: v.width / 2 / zoom - c.x + nudge / zoom,
            scrollY: v.height / 2 / zoom - c.y,
          },
        }),
      { zoom, c: CENTER, v: VIEW, nudge },
    );
    await frame(page);
    await page.waitForTimeout(300);
  }
  return page.evaluate(() => window.excalidrawAPI.getAppState().zoom.value);
};

const MAIN_NAMES = {
  script: ["FunctionCall", "EventDispatch", "TimerFire", "FireAnimationFrame", "v8.evaluateModule"],
  style: ["UpdateLayoutTree"],
  layout: ["Layout"],
  paint: ["Paint"],
  prepaint: ["PrePaint", "Layerize", "UpdateLayer", "CompositeLayers", "Commit"],
};

const panTrace = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(opts.throttle) });
  const events = [];
  cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing,toplevel,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents",
  });
  await page.evaluate(() => performance.mark("pan-start"));
  const frames = Number(opts.frames);
  for (let i = 0; i < frames; i++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 7, deltaY: 3,
    });
    await frame(page);
  }
  await page.evaluate(() => performance.mark("pan-end"));
  await cdp.send("Tracing.end");
  await done;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const mark = (name) => events.find((e) => e.name === name && e.cat.includes("user_timing"));
  const start = mark("pan-start");
  const end = mark("pan-end");
  const inside = events.filter(
    (e) => e.pid === start.pid && e.tid === start.tid && e.ph === "X" && e.ts >= start.ts && e.ts <= end.ts,
  );
  // nested events overlap, so busy time is the union of their intervals
  const sum = (names) => {
    const spans = inside
      .filter((e) => !names || names.includes(e.name))
      .map((e) => [e.ts, e.ts + e.dur])
      .sort((a, b) => a[0] - b[0]);
    let busy = 0;
    let reach = -Infinity;
    for (const [from, to] of spans) {
      busy += Math.max(0, to - Math.max(from, reach));
      reach = Math.max(reach, to);
    }
    return busy / 1000 / frames;
  };
  const row = { total: sum(null) };
  for (const [k, names] of Object.entries(MAIN_NAMES)) row[k] = sum(names);
  row.paints = inside.filter((e) => e.name === "Paint").length / frames;
  row.styledElements =
    inside.filter((e) => e.name === "UpdateLayoutTree").reduce((a, e) => a + (e.args?.elementCount ?? 0), 0) / frames;
  row.wallMs = (end.ts - start.ts) / 1000 / frames;
  return row;
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

if (opts.shots) {
  mkdirSync(here, { recursive: true });
  for (const variant of VARIANTS) {
    const { context, page } = await open(variant);
    for (const zoom of ZOOMS) {
      const actual = await lookAt(page, zoom);
      const file = path.join(here, `${variant}-${zoom}x.png`);
      await page.screenshot({
        path: file,
        clip: { x: VIEW.width / 2 - 240, y: VIEW.height / 2 - 160, width: 480, height: 320 },
      });
      console.log(`shot ${variant} zoom ${actual} -> ${path.basename(file)}`);
    }
    await context.close();
  }
}

const results = {};
for (const zoom of [1, 1e5]) {
  for (const variant of VARIANTS) {
    const rows = [];
    for (let run = 0; run < Number(opts.runs); run++) {
      const { context, page } = await open(variant);
      await lookAt(page, zoom);
      rows.push(await panTrace(page));
      await context.close();
    }
    const summary = Object.fromEntries(Object.keys(rows[0]).map((k) => [k, median(rows.map((r) => r[k]))]));
    results[`${variant}@${zoom}x`] = summary;
    console.log(
      `${variant.padEnd(6)} zoom ${String(zoom).padEnd(6)} main ${summary.total.toFixed(2)} ms/frame (script ${summary.script.toFixed(2)} style ${summary.style.toFixed(2)} layout ${summary.layout.toFixed(2)} paint ${summary.paint.toFixed(2)} prepaint+layerize ${summary.prepaint.toFixed(2)}) paints/frame ${summary.paints.toFixed(2)} styled els/frame ${summary.styledElements.toFixed(0)} wall ${summary.wallMs.toFixed(1)}`,
    );
  }
}
writeFileSync(path.join(here, `results-throttle${opts.throttle}.json`), JSON.stringify(results, null, 2));

await browser.close();
server.close();
