import { readdirSync, readFileSync } from "node:fs";
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
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
for (const file of files) {
  const other = file.replace(`-${a}-`, `-${b}-`);
  const url = (f) =>
    `data:image/png;base64,${readFileSync(path.join(dir, f)).toString(
      "base64",
    )}`;
  const { pixels, maxDelta } = await page.evaluate(
    async ([x, y]) => {
      const load = (src) =>
        new Promise((resolve) => {
          const i = new Image();
          i.onload = () => {
            const c = document.createElement("canvas");
            c.width = i.width;
            c.height = i.height;
            const g = c.getContext("2d");
            g.drawImage(i, 0, 0);
            resolve(g.getImageData(0, 0, i.width, i.height).data);
          };
          i.src = src;
        });
      const [p, q] = await Promise.all([load(x), load(y)]);
      let pixels = 0;
      let maxDelta = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(
          Math.abs(p[i] - q[i]),
          Math.abs(p[i + 1] - q[i + 1]),
          Math.abs(p[i + 2] - q[i + 2]),
          Math.abs(p[i + 3] - q[i + 3]),
        );
        if (d) {
          pixels++;
          maxDelta = Math.max(maxDelta, d);
        }
      }
      return { pixels, maxDelta };
    },
    [url(file), url(other)],
  );
  console.log(
    `${file.replace(
      `-${a}-`,
      "-",
    )}: ${pixels} px differ, max delta ${maxDelta}`,
  );
}
await browser.close();
