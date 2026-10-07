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
    engine: { type: "string", default: "chromium" },
    out: { type: "string" },
    "expect-split": { type: "boolean", default: false },
  },
});
if (!opts.builds || !opts.only) {
  console.error(
    "usage: node perf-bench/parity.mjs --builds base,cand --only <scenario>[,...] [--wait 4000] [--engine chromium|webkit] [--out dir] [--expect-split]\n" +
      "compares what the canvases show (static plus new-element canvas) at each gesture's last move and after the run; --expect-split fails unless cand's last move skipped a full static repaint",
  );
  process.exit(2);
}

const root = path.join(here, "builds");
const server = createServer((req, res) => {
  const file = path.join(
    root,
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  if (!file.startsWith(root) || !existsSync(file)) {
    return res.writeHead(404).end();
  }
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

const browser =
  opts.engine === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chromium" });

// Counts full repaints of the static canvas (the background fill that
// bootstrapCanvas does first) per gesture step, and captures what the user
// sees: the static canvas with the new-element canvas over it.
const instrument = () => {
  const isStatic = (canvas) => canvas?.classList?.contains("static");
  const fillRect = CanvasRenderingContext2D.prototype.fillRect;
  window.staticRepaints = 0;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
    if (
      isStatic(this.canvas) &&
      x === 0 &&
      y === 0 &&
      w * h * window.devicePixelRatio ** 2 >=
        this.canvas.width * this.canvas.height * 0.9
    ) {
      window.staticRepaints++;
    }
    return fillRect.call(this, x, y, w, h);
  };
  const repaintsAtStep = [];
  window.stepHook = (_, step) => {
    repaintsAtStep[step] = window.staticRepaints;
  };
  const composite = () => {
    const canvases = [
      ...document.querySelectorAll("canvas.excalidraw__canvas"),
    ].filter((canvas) => !canvas.classList.contains("interactive"));
    const staticCanvas = canvases.find(isStatic);
    const out = document.createElement("canvas");
    out.width = staticCanvas.width;
    out.height = staticCanvas.height;
    const context = out.getContext("2d");
    context.drawImage(staticCanvas, 0, 0);
    for (const canvas of canvases) {
      if (canvas !== staticCanvas) {
        context.drawImage(canvas, 0, 0);
      }
    }
    return out.toDataURL("image/png");
  };
  window.parity = { frames: {}, repaints: {} };
  window.profilerHook = async (id, phase) => {
    if (phase === "stop") {
      const steps = repaintsAtStep.length - 1;
      // the last move's paints land in React effects and the next frame
      for (let i = 0; i < 2; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      window.parity.frames[id] = composite();
      window.parity.repaints[id] = {
        lastMoveRepainted: window.staticRepaints !== repaintsAtStep[steps],
        movesRepainted: repaintsAtStep.filter(
          (count, step) => step > 1 && count !== repaintsAtStep[step - 1],
        ).length,
        moves: steps,
      };
      repaintsAtStep.length = 0;
    }
  };
  window.compositeNow = composite;
};

const capture = async (build, only) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  await page.goto(
    `${base}/${build}/index.html?bench=auto&only=${only}&wait=${opts.wait}`,
  );
  await page.waitForFunction(
    () => window.benchReport || window.benchError,
    null,
    { timeout: 15 * 60_000, polling: 500 },
  );
  await page.waitForTimeout(2000);
  const result = await page.evaluate(
    (only) => ({
      error: window.benchError,
      frames: {
        ...window.parity.frames,
        [`${only} final`]: window.compositeNow(),
      },
      repaints: window.parity.repaints,
    }),
    only,
  );
  await context.close();
  if (result.error) {
    throw new Error(`${build}: ${result.error}`);
  }
  return result;
};

const [a, b] = opts.builds.split(",");
const merge = (results) => ({
  frames: Object.assign({}, ...results.map((r) => r.frames)),
  repaints: Object.assign({}, ...results.map((r) => r.repaints)),
});
const scenarios = opts.only.split(",");
const resultsA = [];
const resultsB = [];
for (const only of scenarios) {
  resultsA.push(await capture(a, only));
  resultsB.push(await capture(b, only));
}
const resultA = merge(resultsA);
const resultB = merge(resultsB);
if (opts.out) {
  mkdirSync(opts.out, { recursive: true });
  for (const [build, { frames }] of [
    [a, resultA],
    [b, resultB],
  ]) {
    for (const [id, url] of Object.entries(frames)) {
      const file = path.join(
        opts.out,
        `${opts.engine}-${build}-${id.replace(/[^a-z0-9]+/gi, "-")}.png`,
      );
      writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    }
  }
}

const page = await browser.newPage();
let failed = false;
for (const id of Object.keys(resultA.frames)) {
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
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const width = Math.sqrt((p.length / 4) * 1.6);
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
          const x = (i / 4) % width;
          const y = Math.floor(i / 4 / width);
          box[0] = Math.min(box[0], x);
          box[1] = Math.min(box[1], y);
          box[2] = Math.max(box[2], x);
          box[3] = Math.max(box[3], y);
        }
      }
      return { pixels, maxDelta, total: p.length / 4, box };
    },
    [resultA.frames[id], resultB.frames[id]],
  );
  const repaintsA = resultA.repaints[id];
  const repaintsB = resultB.repaints[id];
  const split = repaintsB && !repaintsB.lastMoveRepainted;
  if (opts["expect-split"] && repaintsB && !split) {
    failed = true;
  }
  console.log(
    `${opts.engine} ${id}: ${diff.pixels} of ${
      diff.total
    } pixels differ, max channel delta ${diff.maxDelta}${
      diff.pixels
        ? ` in x ${diff.box[0]}-${diff.box[2]} y ${diff.box[1]}-${diff.box[3]}`
        : ""
    }` +
      (repaintsB
        ? `; static full repaints ${a} ${repaintsA.movesRepainted}/${
            repaintsA.moves
          } moves, ${b} ${repaintsB.movesRepainted}/${
            repaintsB.moves
          }, ${b}'s captured move ${
            split ? "skipped the repaint" : "REPAINTED"
          }`
        : ""),
  );
}
await browser.close();
server.close();
if (failed) {
  console.error(
    `--expect-split: a captured move of ${b} repainted the static canvas`,
  );
  process.exit(1);
}
