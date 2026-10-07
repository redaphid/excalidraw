import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    builds: { type: "string" },
    only: { type: "string" },
    wait: { type: "string", default: "4000" },
    out: { type: "string" },
  },
});
if (!opts.builds || !opts.only) {
  console.error(
    "usage: node perf-bench/parity.mjs --builds a,b --only <scenario>[,<scenario>] [--wait 4000]; compares the static canvas at each gesture's last move and after the run",
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

const browser = await chromium.launch({ channel: "chromium" });
const capture = async (build) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.staticFrames = {};
    window.profilerHook = async (id, phase) => {
      if (phase === "stop") {
        window.staticFrames[id] = document
          .querySelector("canvas.excalidraw__canvas.static")
          .toDataURL("image/png");
      }
    };
  });
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
    "final (after release and settle)": document
      .querySelector("canvas.excalidraw__canvas.static")
      .toDataURL("image/png"),
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
    for (const [id, url] of Object.entries(frames)) {
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
    [framesA[id], framesB[id]],
  );
  console.log(
    `${id}: ${a} vs ${b}: ${diff.pixels} of ${
      diff.total
    } pixels differ, max channel delta ${diff.maxDelta}${
      diff.sameLength ? "" : " (sizes differ)"
    }`,
  );
}
await browser.close();
server.close();
