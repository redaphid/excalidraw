import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

// Times the editor's synchronous pointerdown handler on a board of N
// elements, per tool: the cost a stroke or a shape pays before its first
// point lands. Builds come from build.mjs and open the plain playground.
const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    builds: { type: "string" },
    counts: { type: "string", default: "5000,50000" },
    tools: { type: "string", default: "freedraw,rectangle,selection" },
    runs: { type: "string", default: "3" },
    repeats: { type: "string", default: "15" },
    throttle: { type: "string", default: "1" },
    channel: { type: "string", default: "chromium" },
    label: { type: "string", default: "pointerdown" },
  },
});

if (!opts.builds) {
  console.error(
    "usage: node perf-bench/pointerdown.mjs --builds base,cand [--counts 5000,50000] [--tools freedraw,rectangle,selection] [--runs 3] [--repeats 15] [--throttle 1] [--channel chromium|chrome|msedge] [--label name]",
  );
  process.exit(2);
}
const builds = opts.builds.split(",");
const counts = opts.counts.split(",").map(Number);
const tools = opts.tools.split(",");
const runs = Number(opts.runs);
const repeats = Number(opts.repeats);
const throttle = Number(opts.throttle);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const serve = () =>
  new Promise((resolve) => {
    const root = path.join(here, "builds");
    const server = createServer((req, res) => {
      const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Runs in the page: loads `count` rectangles, then times each tool's
// pointerdown dispatch, which returns once the editor's handler has run.
const measureInPage = async ({ count, tools, repeats }) => {
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
        button: type === "pointermove" ? -1 : 0,
        buttons: type === "pointerup" ? 0 : 1,
        pressure: type === "pointerup" ? 0 : 0.5,
      }),
    );
  const out = {};
  for (const tool of tools) {
    const samples = [];
    for (let r = 0; r < repeats; r++) {
      // a shape click without a drag hands the editor back to selection
      api.setActiveTool({ type: tool });
      await frame();
      if (api.getAppState().activeTool.type !== tool) {
        throw new Error(`${tool} is not the active tool`);
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
    out[tool] = samples;
  }
  return { sceneSize: api.getSceneElements().length, samples: out };
};

const runOnce = async (browser, port, build, count) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  if (throttle > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  await page.goto(`http://127.0.0.1:${port}/${build}/index.html`);
  await page.waitForFunction(() => window.excalidrawAPI, null, { timeout: 120_000 });
  const result = await page.evaluate(measureInPage, { count, tools, repeats });
  await context.close();
  return result;
};

const main = async () => {
  const server = await serve();
  const { port } = server.address();
  const browser = await chromium.launch({
    channel: opts.channel,
    headless: opts.channel === "chromium",
  });
  const samples = {};
  for (let run = 0; run < runs; run++) {
    const order = run % 2 ? [...builds].reverse() : builds;
    for (const count of counts) {
      for (const build of order) {
        const { samples: byTool } = await runOnce(browser, port, build, count);
        for (const [tool, xs] of Object.entries(byTool)) {
          const key = `${count}/${tool}`;
          samples[key] ??= Object.fromEntries(builds.map((b) => [b, []]));
          samples[key][build].push(...xs);
        }
        console.error(`run ${run + 1}/${runs} ${count} ${build}`);
      }
    }
  }
  const userAgent = await (await browser.newPage()).evaluate(() => navigator.userAgent);
  await browser.close();
  server.close();

  const summary = Object.fromEntries(
    Object.entries(samples).map(([key, byBuild]) => [
      key,
      Object.fromEntries(
        Object.entries(byBuild).map(([build, xs]) => [
          build,
          { median: median(xs), max: Math.max(...xs), n: xs.length },
        ]),
      ),
    ]),
  );

  const out = path.join(here, "results");
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(out, `${stamp}-${opts.label}.json`);
  writeFileSync(file, JSON.stringify({ opts, userAgent, summary, samples }, null, 1));

  const [base, ...others] = builds;
  console.log(`pointerdown handler ms, ${opts.channel} throttle ${throttle}x, ${runs} runs x ${repeats} repeats, ${userAgent}`);
  for (const [key, byBuild] of Object.entries(summary)) {
    const b = byBuild[base];
    const line = [`${key.padEnd(18)} ${base} median ${b.median.toFixed(2)} max ${b.max.toFixed(2)}`];
    for (const other of others) {
      const c = byBuild[other];
      line.push(`| ${other} median ${c.median.toFixed(2)} max ${c.max.toFixed(2)} (${(b.median / c.median).toFixed(1)}x)`);
    }
    console.log(line.join(" "));
  }
  console.log(`saved ${file}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
