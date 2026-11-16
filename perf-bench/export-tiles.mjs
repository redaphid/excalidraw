import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";
import { build, loadConfigFromFile } from "vite";

// Exports a scene tile by tile through the public exportToCanvas and profiles
// it, so font loading's share of a tile export can be measured before and
// after a change. --scene file --file <path> reads a .excalidraw from disk
// without copying it anywhere.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const { values: opts } = parseArgs({
  options: {
    name: { type: "string", default: "head" },
    scene: { type: "string", default: "labels" },
    file: { type: "string" },
    tile: { type: "string", default: "1024" },
    scale: { type: "string", default: "0.5" },
    passes: { type: "string", default: "2" },
    throttle: { type: "string", default: "1" },
    top: { type: "string", default: "12" },
    "skip-build": { type: "boolean", default: false },
    "build-only": { type: "boolean", default: false },
  },
});
if (opts.scene === "file" && !opts.file) {
  console.error(
    "usage: node perf-bench/export-tiles.mjs --name <build> [--scene labels|big|huge|file --file <path.excalidraw>] [--tile 1024] [--scale 0.5] [--passes 2] [--throttle 1] [--skip-build | --build-only]",
  );
  process.exit(2);
}

const outDir = path.join(here, "builds", `export-tiles-${opts.name}`);
if (!opts["skip-build"]) {
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    path.join(root, "playground", "vite.config.mts"),
  );
  await build({
    ...loaded.config,
    root: path.join(here, "export-tiles"),
    configFile: false,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true, minify: false },
  });
  console.log(`built ${outDir}`);
}
if (opts["build-only"]) {
  process.exit(0);
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname === "/scene.json") {
    res.writeHead(200, { "content-type": MIME[".json"] });
    res.end(readFileSync(opts.file));
    return;
  }
  const file = path.join(outDir, pathname);
  if (!file.startsWith(outDir) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const type = MIME[path.extname(file)];
  res.writeHead(200, type ? { "content-type": type } : {});
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", {
  rate: Number(opts.throttle),
});
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
const profiles = [];
await page.exposeFunction("profilerHook", async (id, phase) => {
  if (phase === "start") {
    await cdp.send("Profiler.start");
  } else {
    const { profile } = await cdp.send("Profiler.stop");
    profiles.push({ id, profile });
  }
});
page.on("console", (message) => {
  if (message.type() === "error") {
    console.error(`[page] ${message.text()}`);
  }
});
const query = new URLSearchParams({
  scene: opts.scene,
  tile: opts.tile,
  scale: opts.scale,
  passes: opts.passes,
});
await page.goto(
  `http://127.0.0.1:${server.address().port}/index.html?${query}`,
);
await page.waitForFunction(
  () => window.benchReport || window.benchError,
  null,
  {
    timeout: 15 * 60_000,
    polling: 250,
  },
);
const error = await page.evaluate(() => window.benchError);
const report = await page.evaluate(() => window.benchReport);
await browser.close();
server.close();
if (error) {
  console.error(error);
  process.exit(1);
}

const profileDir = path.join(here, "profiles");
mkdirSync(profileDir, { recursive: true });
const selfTimes = (profile) => {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let all = 0;
  profile.samples.forEach((sample, i) => {
    const us = profile.timeDeltas[i] ?? 0;
    all += us;
    const { functionName, url, lineNumber } = byId.get(sample).callFrame;
    const key = `${functionName || "(anonymous)"} ${url.split("/").pop()}:${
      lineNumber + 1
    }`;
    self.set(key, (self.get(key) ?? 0) + us);
  });
  return { self, all };
};

console.log(
  `${report.scene}: ${report.elements} elements (${report.textElements} text), tile ${report.tileScene} at scale ${report.scale}, throttle ${opts.throttle}x`,
);
for (const [i, pass] of report.passes.entries()) {
  const perTile = pass.exportMs / pass.tiles;
  console.log(
    `pass ${i + 1}: ${pass.tiles} tiles in ${pass.exportMs.toFixed(
      0,
    )}ms (${perTile.toFixed(2)}ms/tile); fonts.check ${
      pass.checkCalls
    } calls, ${pass.checkMs.toFixed(1)}ms, ${
      pass.checkChars
    } chars; fonts.load ${pass.loadCalls} calls`,
  );
}
for (const { id, profile } of profiles) {
  const file = path.join(
    profileDir,
    `export-tiles-${opts.name}-${id}.cpuprofile`,
  );
  writeFileSync(file, JSON.stringify(profile));
  const { self, all } = selfTimes(profile);
  const check = [...self]
    .filter(([k]) => k.startsWith("check "))
    .reduce((s, [, us]) => s + us, 0);
  console.log(
    `\n${id} profile: ${(all / 1000).toFixed(0)}ms sampled, fonts.check self ${(
      check / 1000
    ).toFixed(1)}ms (${((check / all) * 100).toFixed(1)}%) -> ${file}`,
  );
  for (const [k, us] of [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(opts.top))) {
    console.log(
      `${(us / 1000).toFixed(1).padStart(9)}ms ${((us / all) * 100)
        .toFixed(1)
        .padStart(5)}%  ${k}`,
    );
  }
}
