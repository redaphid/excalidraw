#!/usr/bin/env node
/**
 * Copies the screenshots the theming docs show from a pass directory into
 * docs/theming as WebP, scaled down: per theme the desktop scene with a
 * selection and the 2.5x pen close-up, plus the contact sheets.
 *
 *   node scripts/theme-screenshots/export-docs.mjs <passdir> [--quality 0.82]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const [passDir, , quality = "0.82"] = process.argv.slice(2);
const out = path.join(root, "docs/theming");

const SHOTS = [
  { file: "desktop-selected.png", width: 1200 },
  { file: "desktop-penzoom.png", width: 900 },
];
const CONTACTS = [
  { file: "contact-desktop.png", width: 1600 },
  { file: "contact-phone.png", width: 1600 },
];

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

const jobs = [
  ...fs
    .readdirSync(passDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      SHOTS.map(({ file, width }) => ({
        from: path.join(passDir, entry.name, file),
        to: path.join(out, `${entry.name}-${file.replace(/\.png$/, ".webp")}`),
        width,
      })),
    ),
  ...CONTACTS.map(({ file, width }) => ({
    from: path.join(passDir, file),
    to: path.join(out, file.replace(/\.png$/, ".webp")),
    width,
  })),
].filter((job) => fs.existsSync(job.from));

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage();
let total = 0;
try {
  for (const job of jobs) {
    const png = `data:image/png;base64,${fs
      .readFileSync(job.from)
      .toString("base64")}`;
    const webp = await page.evaluate(
      async ({ png, width, quality }) => {
        const img = new Image();
        img.src = png;
        await img.decode();
        const scale = Math.min(1, width / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/webp", quality);
      },
      { png, width: job.width, quality: Number(quality) },
    );
    const bytes = Buffer.from(webp.split(",")[1], "base64");
    fs.writeFileSync(job.to, bytes);
    total += bytes.length;
    console.log(
      `${path.relative(root, job.to)} ${(bytes.length / 1024).toFixed(0)} KB`,
    );
  }
} finally {
  await browser.close();
}
console.log(`${jobs.length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
