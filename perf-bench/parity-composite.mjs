import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium, webkit } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    builds: { type: "string" },
    only: { type: "string" },
    wait: { type: "string", default: "4000" },
    out: { type: "string" },
    engine: { type: "string", default: "chromium" },
    settle: { type: "boolean", default: false },
  },
});
if (!opts.builds || !opts.only) {
  console.error(
    "usage: node perf-bench/parity-composite.mjs --builds a,b --only <scenario>[,<scenario>] [--wait 4000] [--engine chromium|webkit] [--settle]; compares the static and new-element canvases composited, at each gesture's last move and after the run, and reports whether that move was split (the new-element canvas painted and the static canvas did not)",
  );
  process.exit(2);
}

const root = path.join(here, "builds");
const server = createServer((req, res) => {
  const file = path.join(
    root,
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  if (!file.startsWith(root) || !existsSync(file))
    return res.writeHead(404).end();
  const type = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
  }[path.extname(file)];
  res.writeHead(200, type ? { "content-type": type } : {});
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// new elements take their roughness seeds from an RNG seeded with Date.now()
// when the module loads; both builds get the same one so they draw the same
const loadedAt = Date.now();
const browser =
  opts.engine === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chromium" });
const capture = async (build) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(({ loadedAt, settle }) => {
    const { now } = Date;
    Date.now = () => loadedAt;
    document.addEventListener("DOMContentLoaded", () => (Date.now = now));
    const scenePaints = new Map();
    const { setTransform } = CanvasRenderingContext2D.prototype;
    CanvasRenderingContext2D.prototype.setTransform = function (...args) {
      if (args.join() === "1,0,0,1,0,0") {
        scenePaints.set(this.canvas, (scenePaints.get(this.canvas) ?? 0) + 1);
      }
      return setTransform.apply(this, args);
    };
    let paintsAtMove = new Map();
    window.addEventListener(
      "pointermove",
      () => (paintsAtMove = new Map(scenePaints)),
      true,
    );
    const canvases = () => {
      const all = [...document.querySelectorAll("canvas.excalidraw__canvas")];
      return {
        staticCanvas: all.find((c) => c.classList.contains("static")),
        newElementCanvas: all.find(
          (c) =>
            !c.classList.contains("static") &&
            !c.classList.contains("interactive"),
        ),
      };
    };
    const hasContent = (canvas) => {
      const { data } = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i]) {
          return true;
        }
      }
      return false;
    };
    window.captureComposite = () => {
      const { staticCanvas, newElementCanvas } = canvases();
      const since = (canvas) =>
        (scenePaints.get(canvas) ?? 0) - (paintsAtMove.get(canvas) ?? 0);
      const composite = document.createElement("canvas");
      composite.width = staticCanvas.width;
      composite.height = staticCanvas.height;
      const context = composite.getContext("2d");
      context.drawImage(staticCanvas, 0, 0);
      if (newElementCanvas) {
        context.drawImage(newElementCanvas, 0, 0);
      }
      const staticRepainted = since(staticCanvas) > 0;
      const overlayPainted =
        !!newElementCanvas &&
        since(newElementCanvas) > 0 &&
        hasContent(newElementCanvas);
      return {
        url: composite.toDataURL("image/png"),
        split: overlayPainted && !staticRepainted,
        staticRepainted,
        overlayPainted,
      };
    };
    window.staticFrames = {};
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const task = () => new Promise((resolve) => setTimeout(resolve));
    window.profilerHook = async (id, phase) => {
      if (phase === "stop") {
        if (settle) {
          await frame();
          await task();
          await frame();
          await task();
        }
        window.staticFrames[id] = window.captureComposite();
      }
    };
  }, { loadedAt, settle: opts.settle });
  await page.goto(
    `${base}/${build}/index.html?bench=auto&only=${opts.only}&wait=${opts.wait}`,
  );
  await page.waitForFunction(
    () => window.benchReport || window.benchError,
    null,
    {
      timeout: 15 * 60_000,
      polling: 500,
    },
  );
  const frames = await page.evaluate(() => ({
    ...window.staticFrames,
    "final (after release and settle)": window.captureComposite(),
  }));
  await context.close();
  return frames;
};

const [a, b] = opts.builds.split(",");
const framesA = await capture(a);
const framesB = await capture(b);
if (opts.out) {
  mkdirSync(opts.out, { recursive: true });
  for (const [build, frames] of [
    [a, framesA],
    [b, framesB],
  ]) {
    for (const [id, { url }] of Object.entries(frames)) {
      const file = path.join(
        opts.out,
        `${build}-${id.replace(/[^a-z0-9]+/gi, "-")}.png`,
      );
      writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    }
  }
}
const page = await browser.newPage();
for (const id of Object.keys(framesA)) {
  const diff = await page.evaluate(
    async ([x, y]) => {
      const load = (src) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            resolve(context.getImageData(0, 0, image.width, image.height).data);
          };
          image.src = src;
        });
      const [p, q] = await Promise.all([load(x), load(y)]);
      let pixels = 0;
      let maxDelta = 0;
      for (let i = 0; i < p.length; i += 4) {
        const delta = Math.max(
          Math.abs(p[i] - q[i]),
          Math.abs(p[i + 1] - q[i + 1]),
          Math.abs(p[i + 2] - q[i + 2]),
          Math.abs(p[i + 3] - q[i + 3]),
        );
        if (delta) {
          pixels++;
          maxDelta = Math.max(maxDelta, delta);
        }
      }
      return {
        pixels,
        maxDelta,
        total: p.length / 4,
        sameLength: p.length === q.length,
      };
    },
    [framesA[id].url, framesB[id].url],
  );
  const split = (frame) =>
    frame.split
      ? "split"
      : `not split (static ${
          frame.staticRepainted ? "repainted" : "held"
        }, overlay ${frame.overlayPainted ? "painted" : "empty"})`;
  console.log(
    `${id}: ${a} vs ${b}: ${diff.pixels} of ${
      diff.total
    } pixels differ, max channel delta ${diff.maxDelta}${
      diff.sameLength ? "" : " (sizes differ)"
    }; ${a} ${split(framesA[id])}, ${b} ${split(framesB[id])}`,
  );
}
await browser.close();
server.close();
