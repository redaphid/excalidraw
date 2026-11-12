import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";

const [dir, a, b, filter = ""] = process.argv.slice(2);
if (!b) {
  console.error(
    "usage: node perf-bench/pngdiff.mjs <dir> <buildA> <buildB> [name filter]; counts differing pixels between <engine>-<a>-<id>.png and <engine>-<b>-<id>.png",
  );
  process.exit(2);
}
const files = readdirSync(dir).filter(
  (f) => f.includes(`-${a}-`) && f.includes(filter),
);

let browser;
let page;

const compare = ([x, y, xName, yName]) => {
  const load = (src, name) =>
    new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => {
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const g = c.getContext("2d");
        g.drawImage(i, 0, 0);
        resolve({
          size: `${i.width}x${i.height}`,
          data: g.getImageData(0, 0, i.width, i.height).data,
        });
      };
      i.onerror = () => reject(new Error(`${name} does not decode`));
      i.src = src;
    });
  return Promise.all([load(x, xName), load(y, yName)]).then(([p, q]) => {
    if (p.size !== q.size) {
      return { sizes: [p.size, q.size] };
    }
    let pixels = 0;
    let maxDelta = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.max(
        Math.abs(p.data[i] - q.data[i]),
        Math.abs(p.data[i + 1] - q.data[i + 1]),
        Math.abs(p.data[i + 2] - q.data[i + 2]),
        Math.abs(p.data[i + 3] - q.data[i + 3]),
      );
      if (d) {
        pixels++;
        maxDelta = Math.max(maxDelta, d);
      }
    }
    return { pixels, maxDelta };
  });
};

for (const file of files) {
  const other = file.replace(`-${a}-`, `-${b}-`);
  const name = file.replace(`-${a}-`, "-");
  if (!existsSync(path.join(dir, other))) {
    console.log(`${name}: ${other} is missing`);
    process.exitCode = 1;
    continue;
  }
  const [x, y] = [file, other].map((f) => readFileSync(path.join(dir, f)));
  if (x.equals(y)) {
    console.log(`${name}: 0 px differ, max delta 0 (byte-identical)`);
    continue;
  }
  if (!page) {
    browser = await chromium.launch({ channel: "chromium" });
    page = await browser.newPage();
  }
  const url = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
  try {
    const { pixels, maxDelta, sizes } = await page.evaluate(compare, [
      url(x),
      url(y),
      file,
      other,
    ]);
    console.log(
      sizes
        ? `${name}: sizes differ, ${sizes[0]} vs ${sizes[1]}`
        : `${name}: ${pixels} px differ, max delta ${maxDelta}`,
    );
  } catch (error) {
    console.log(`${name}: ${error.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
}
await browser?.close();
