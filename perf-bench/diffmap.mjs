import { readFileSync, writeFileSync } from "node:fs";

import { chromium } from "playwright-core";

const [a, b, out] = process.argv.slice(2);
if (!out) {
  console.error(
    "usage: node perf-bench/diffmap.mjs a.png b.png out.png (differing pixels in red over a faded a, half size)",
  );
  process.exit(2);
}
const url = (file) =>
  `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
const png = await page.evaluate(
  async ([x, y]) => {
    const load = (src) =>
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = src;
      });
    const [p, q] = await Promise.all([load(x), load(y)]);
    const pixels = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    };
    const pa = pixels(p);
    const pb = pixels(q);
    for (let i = 0; i < pa.data.length; i += 4) {
      const differs =
        pa.data[i] !== pb.data[i] ||
        pa.data[i + 1] !== pb.data[i + 1] ||
        pa.data[i + 2] !== pb.data[i + 2];
      if (differs) {
        pa.data[i] = 255;
        pa.data[i + 1] = 0;
        pa.data[i + 2] = 0;
      } else {
        pa.data[i] = 255 - (255 - pa.data[i]) * 0.25;
        pa.data[i + 1] = 255 - (255 - pa.data[i + 1]) * 0.25;
        pa.data[i + 2] = 255 - (255 - pa.data[i + 2]) * 0.25;
      }
    }
    const full = document.createElement("canvas");
    full.width = pa.width;
    full.height = pa.height;
    full.getContext("2d").putImageData(pa, 0, 0);
    const half = document.createElement("canvas");
    half.width = pa.width / 2;
    half.height = pa.height / 2;
    half.getContext("2d").drawImage(full, 0, 0, half.width, half.height);
    return half.toDataURL("image/png");
  },
  [url(a), url(b)],
);
writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
await browser.close();
console.log(`wrote ${out}`);
