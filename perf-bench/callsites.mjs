// node perf-bench/callsites.mjs --build <name> --only <scenario> [--method Map.set]
// Samples the call stacks of one built-in method during one gesture and prints
// the most common callers. Build with --no-minify for readable names.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    build: { type: "string" },
    only: { type: "string" },
    method: { type: "string", default: "Map.set" },
    every: { type: "string", default: "50" },
  },
});
if (!opts.build || !opts.only) {
  console.error(
    "usage: node perf-bench/callsites.mjs --build <name> --only <scenario> [--method Map.set] [--every 50]",
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

const browser = await chromium.launch({ channel: "chromium" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.addInitScript(
  ({ method, every }) => {
    const [owner, name] = method.split(".");
    const proto = window[owner].prototype;
    const original = proto[name];
    let on = false;
    let n = 0;
    const sites = new Map();
    proto[name] = function (...args) {
      if (on && ++n % every === 0) {
        const stack = new Error().stack
          .split("\n")
          .slice(2, 6)
          .map((l) => l.trim().replace(/\(.*\//, "("))
          .join(" < ");
        sites.set(stack, (sites.get(stack) ?? 0) + 1);
      }
      return original.apply(this, args);
    };
    window.profilerHook = async (_id, phase) => {
      on = phase === "start";
      if (!on)
        window.callsites = {
          total: n,
          sites: [...sites].sort((a, b) => b[1] - a[1]).slice(0, 12),
        };
    };
  },
  { method: opts.method, every: Number(opts.every) },
);
const query = new URLSearchParams({ bench: "auto", only: opts.only });
await page.goto(
  `http://127.0.0.1:${server.address().port}/${opts.build}/index.html?${query}`,
);
await page.waitForFunction(
  () => window.benchReport || window.benchError,
  null,
  { timeout: 15 * 60_000, polling: 500 },
);
const { callsites, error } = await page.evaluate(() => ({
  callsites: window.callsites,
  error: window.benchError,
}));
await browser.close();
server.close();
if (error) throw new Error(error);
console.log(
  `${opts.method} calls during ${opts.only}: ${callsites.total}, sampled 1 in ${opts.every}`,
);
for (const [stack, count] of callsites.sites)
  console.log(`${String(count * Number(opts.every)).padStart(8)}  ${stack}`);
