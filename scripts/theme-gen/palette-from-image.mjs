#!/usr/bin/env node
/**
 * Pulls a restrained palette out of a reference image: the dominant flat
 * colors, not the noise. Prints them with their coverage and suggested
 * roles, then a starter tokens file to judge and edit.
 *
 *   node scripts/theme-gen/palette-from-image.mjs <image> [--colors 8] [--name "Theme Name"]
 *
 * Runs k-means in the preinstalled Chromium (no image libraries), merges
 * clusters closer than a just-visible difference and drops any under 1.5%
 * of the image. Roles are a first guess: the most common color is the
 * canvas, the darkest real color is the ink, the most saturated is the
 * accent. Look at the image and correct them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const image = argv.find((arg) => !arg.startsWith("--") && !/^\d+$/.test(arg));
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
if (!image || !fs.existsSync(image)) {
  console.error(
    "usage: palette-from-image.mjs <image> [--colors 8] [--name NAME]",
  );
  process.exit(1);
}

const chromiumPath = () => {
  const dir = path.join(
    process.env.LOCALAPPDATA ?? os.homedir(),
    "ms-playwright",
  );
  const build = fs
    .readdirSync(dir)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  return path.join(dir, build, "chrome-win64", "chrome.exe");
};

const mime = image.endsWith(".png") ? "image/png" : "image/jpeg";
const src = `data:${mime};base64,${fs.readFileSync(image).toString("base64")}`;
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage();
const clusters = await page.evaluate(
  async ({ src, k }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = 160 / Math.max(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    const distance = (a, b) =>
      (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    // deterministic seeds spread over the pixel list
    let centers = Array.from(
      { length: k },
      (_, i) => pixels[Math.floor(((i + 0.5) / k) * pixels.length)],
    );
    let groups = [];
    for (let iteration = 0; iteration < 24; iteration++) {
      groups = centers.map(() => []);
      for (const pixel of pixels) {
        let best = 0;
        for (let c = 1; c < centers.length; c++) {
          if (distance(pixel, centers[c]) < distance(pixel, centers[best])) {
            best = c;
          }
        }
        groups[best].push(pixel);
      }
      centers = groups.map((group, c) =>
        group.length
          ? [0, 1, 2].map(
              (axis) =>
                group.reduce((sum, pixel) => sum + pixel[axis], 0) /
                group.length,
            )
          : centers[c],
      );
    }
    return centers.map((center, c) => ({
      rgb: center,
      share: groups[c].length / pixels.length,
    }));
  },
  { src, k: Number(option("colors", 8)) + 4 },
);
await browser.close();

const hex = (rgb) =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const lightness = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
const saturation = ([r, g, b]) => {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
};

// merge clusters a viewer could not tell apart, then drop the specks
const merged = [];
for (const cluster of clusters.sort((a, b) => b.share - a.share)) {
  const twin = merged.find(
    (m) => Math.hypot(...m.rgb.map((v, i) => v - cluster.rgb[i])) < 22,
  );
  if (twin) {
    twin.share += cluster.share;
  } else {
    merged.push({ ...cluster });
  }
}
const colors = merged
  .filter((c) => c.share >= 0.015)
  .sort((a, b) => b.share - a.share)
  .map((c) => ({
    hex: hex(c.rgb),
    share: c.share,
    lightness: lightness(c.rgb),
    saturation: saturation(c.rgb),
  }));

const canvas = colors[0];
const ink = [...colors].sort((a, b) => a.lightness - b.lightness)[0];
const accent = [...colors]
  .filter((c) => c !== canvas && c !== ink)
  .sort((a, b) => b.saturation - a.saturation)[0];
const rest = colors.filter((c) => ![canvas, ink, accent].includes(c));

console.log(`${path.basename(image)}: ${colors.length} colors over 1.5%`);
for (const c of colors) {
  const role =
    c === canvas
      ? "canvas"
      : c === ink
      ? "ink"
      : c === accent
      ? "accent"
      : "palette";
  console.log(
    `  ${c.hex}  ${(c.share * 100)
      .toFixed(1)
      .padStart(5)}%  L ${c.lightness.toFixed(2)}  S ${c.saturation.toFixed(
      2,
    )}  ${role}`,
  );
}
const dark = canvas.lightness < 0.35;
console.log("\nstarter tokens (judge them against the image before using):");
console.log(
  JSON.stringify(
    {
      name: option("name", path.basename(image, path.extname(image))),
      mode: dark ? "dark" : "light",
      description: "",
      canvas: canvas.hex,
      ink: ink.lightness < 0.25 || dark ? ink.hex : "#1b2129",
      accent: accent?.hex ?? ink.hex,
      palette: [accent, ...rest].filter(Boolean).map((c) => c.hex),
      grid: { color: ink.hex, minor: 0.12, major: 0.3, style: "solid" },
      type: { ui: "Liberation Sans", canvas: "Liberation Sans", size: 16 },
      stroke: {
        width: "thin",
        roughness: 0,
        roundness: "sharp",
        arrowhead: "arrow",
        arrowType: "sharp",
        fill: "solid",
      },
      pen: { pressure: true, width: 0.2, thinning: 0.2, taper: 4 },
      surface: { radius: 2, border: "hairline", shadow: "none" },
      frame: { width: 1, alpha: 0.42 },
    },
    null,
    2,
  ),
);
