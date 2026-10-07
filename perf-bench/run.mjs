process.exit(1);
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium, firefox, webkit } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    builds: { type: "string" },
    runs: { type: "string", default: "5" },
    engine: { type: "string", default: "chromium" },
    throttle: { type: "string", default: "4" },
    device: { type: "string", default: "laptop" },
    only: { type: "string" },
    counters: { type: "boolean", default: false },
    label: { type: "string", default: "run" },
  },
});

if (!opts.builds) {
  console.error(
    "usage: node perf-bench/run.mjs --builds base,cand [--runs 5] [--engine chromium|firefox|webkit] [--throttle 4] [--device laptop|phone] [--only mixed/pan,...] [--counters] [--label name]",
  );
  process.exit(2);
}
const builds = opts.builds.split(",");
const runs = Number(opts.runs);
const throttle = Number(opts.throttle);

const DEVICES = {
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
  },
};

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const serve = () =>
  new Promise((resolve) => {
    const root = path.join(here, "builds");
    const server = createServer((req, res) => {
      const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const launch = () => {
  if (opts.engine === "chromium") {
    return chromium.launch({
      channel: "chromium",
      args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
    });
  }
  if (opts.engine === "firefox") {
    return firefox.launch({ firefoxUserPrefs: { "layout.frame_rate": 0 } });
  }
  return webkit.launch();
};

const runOnce = async (browser, port, build) => {
  const context = await browser.newContext(DEVICES[opts.device]);
  const page = await context.newPage();
  if (opts.engine === "chromium" && throttle > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  const query = new URLSearchParams({ bench: "auto" });
  if (opts.only) query.set("only", opts.only);
  if (opts.counters) query.set("counters", "1");
  await page.goto(`http://127.0.0.1:${port}/${build}/index.html?${query}`);
  await page.waitForFunction(() => window.benchReport || window.benchError, null, {
    timeout: 15 * 60_000,
    polling: 500,
  });
  const { report, error } = await page.evaluate(() => ({
    report: window.benchReport,
    error: window.benchError,
  }));
  await context.close();
  if (error) throw new Error(`${build}: ${error}`);
  return report;
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / median(xs);

const METRICS = [
  ["frameP50", (r) => r.frameMs.median],
  ["frameP95", (r) => r.frameMs.p95],
  ["frameMean", (r) => r.frameMs.mean],
  ["releaseMs", (r) => r.releaseMs],
  ["settleMax", (r) => r.settleMaxFrameMs],
];

const main = async () => {
  const server = await serve();
  const { port } = server.address();
  const browser = await launch();
  const reports = Object.fromEntries(builds.map((b) => [b, []]));
  for (let run = 0; run < runs; run++) {
    const order = run % 2 ? [...builds].reverse() : builds;
    for (const build of order) {
      const started = Date.now();
      reports[build].push(await runOnce(browser, port, build));
      console.error(`run ${run + 1}/${runs} ${build} ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  }
  await browser.close();
  server.close();

  const first = reports[builds[0]][0];
  const summary = {};
  for (const { id } of first.results) {
    summary[id] = {};
    for (const build of builds) {
      const rows = reports[build].map((rep) => rep.results.find((r) => r.id === id));
      summary[id][build] = Object.fromEntries(
        METRICS.map(([name, get]) => [name, median(rows.map(get))]),
      );
      summary[id][build].p50Spread = spread(rows.map((r) => r.frameMs.median));
      summary[id][build].meanSpread = spread(rows.map((r) => r.frameMs.mean));
      if (rows[0].countersPerFrame) summary[id][build].counters = rows[0].countersPerFrame;
      if (rows[0].countersAtRelease) summary[id][build].endCounters = rows[0].countersAtRelease;
    }
  }
  const mount = Object.fromEntries(
    builds.map((b) => [
      b,
      Object.fromEntries(
        Object.keys(first.mountMs).map((s) => [s, median(reports[b].map((r) => r.mountMs[s]))]),
      ),
    ]),
  );

  const out = path.join(here, "results");
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(out, `${stamp}-${opts.label}.json`);
  writeFileSync(
    file,
    JSON.stringify({ opts, userAgent: first.userAgent, summary, mount, reports }, null, 1),
  );

  const [base, ...others] = builds;
  const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;
  console.log(`${opts.engine} ${opts.device} throttle ${throttle}x, ${runs} runs, ${first.userAgent}`);
  console.log(`mount ms: ${JSON.stringify(mount)}`);
  for (const [id, byBuild] of Object.entries(summary)) {
    const b = byBuild[base];
    const line = [
      id.padEnd(16),
      `${base} frame p50 ${b.frameP50.toFixed(2)} (±${(b.p50Spread * 50).toFixed(1)}%) mean ${b.frameMean.toFixed(2)} (±${(b.meanSpread * 50).toFixed(1)}%) p95 ${b.frameP95.toFixed(1)} release ${b.releaseMs.toFixed(1)} settle ${b.settleMax.toFixed(1)}`,
    ];
    for (const other of others) {
      const c = byBuild[other];
      line.push(
        `| ${other} frame p50 ${c.frameP50.toFixed(2)} (${pct(b.frameP50, c.frameP50)}) mean ${c.frameMean.toFixed(2)} (${pct(b.frameMean, c.frameMean)}) p95 ${c.frameP95.toFixed(1)} (${pct(b.frameP95, c.frameP95)}) release ${c.releaseMs.toFixed(1)} (${pct(b.releaseMs, c.releaseMs)}) settle ${c.settleMax.toFixed(1)} (${pct(b.settleMax, c.settleMax)})`,
      );
    }
    console.log(line.join(" "));
    if (b.counters) {
      console.log(`  counters/frame ${builds.map((x) => `${x} ${JSON.stringify(byBuild[x].counters)}`).join(" | ")}`);
      console.log(`  counters/release ${builds.map((x) => `${x} ${JSON.stringify(byBuild[x].endCounters)}`).join(" | ")}`);
    }
  }
  console.log(`saved ${file}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
