import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    build: { type: "string" },
    only: { type: "string" },
    throttle: { type: "string", default: "4" },
    device: { type: "string", default: "laptop" },
    top: { type: "string", default: "40" },
  },
});

if (!opts.build || !opts.only) {
  console.error(
    "usage: node perf-bench/profile.mjs --build <name> --only <scenario> [--throttle 4] [--device laptop|phone] [--top 40]; build with --no-minify for readable names",
  );
  process.exit(2);
}

const DEVICES = {
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
  },
};

const root = path.join(here, "builds");
const server = createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
    path.extname(file)
  ];
  res.writeHead(200, type ? { "content-type": type } : {});
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const context = await browser.newContext(DEVICES[opts.device]);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(opts.throttle) });
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
const query = new URLSearchParams({ bench: "auto", only: opts.only });
await page.goto(`http://127.0.0.1:${server.address().port}/${opts.build}/index.html?${query}`);
await page.waitForFunction(() => window.benchReport || window.benchError, null, {
  timeout: 15 * 60_000,
  polling: 500,
});
const error = await page.evaluate(() => window.benchError);
await browser.close();
server.close();
if (error) {
  console.error(error);
  process.exit(1);
}

const out = path.join(here, "profiles");
mkdirSync(out, { recursive: true });
for (const { id, profile } of profiles) {
  const file = path.join(out, `${opts.build}-${id.replace("/", "-")}.cpuprofile`);
  writeFileSync(file, JSON.stringify(profile));

  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const selfUs = new Map();
  profile.samples.forEach((sample, i) => {
    selfUs.set(sample, (selfUs.get(sample) ?? 0) + (profile.timeDeltas[i] ?? 0));
  });
  const key = (n) => {
    const { functionName, url, lineNumber, columnNumber } = n.callFrame;
    return `${functionName || "(anonymous)"} ${url.split("/").pop()}:${lineNumber + 1}:${columnNumber + 1}`;
  };
  const self = new Map();
  const total = new Map();
  let all = 0;
  for (const [nodeId, us] of selfUs) {
    all += us;
    const node = byId.get(nodeId);
    self.set(key(node), (self.get(key(node)) ?? 0) + us);
    const seen = new Set();
    for (let at = nodeId; at !== undefined; at = parent.get(at)) {
      const k = key(byId.get(at));
      if (seen.has(k)) continue;
      seen.add(k);
      total.set(k, (total.get(k) ?? 0) + us);
    }
  }
  const top = Number(opts.top);
  const show = (title, map) => {
    console.log(`\n${title}`);
    for (const [k, us] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top)) {
      console.log(`${(us / 1000).toFixed(1).padStart(9)}ms ${((us / all) * 100).toFixed(1).padStart(5)}%  ${k}`);
    }
  };
  console.log(`\n=== ${id}: ${(all / 1000).toFixed(0)}ms sampled, ${file}`);
  show("self", self);
  show("inclusive", total);
}
