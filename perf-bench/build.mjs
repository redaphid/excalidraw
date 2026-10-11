import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vite's HTML proxy cache misses when a path's casing differs from the one
// on disk, and the build then fails ("No matching HTML proxy module"), as it
// did from a shell that spelled the folder D:/projects when it is D:/Projects
const here = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(here, "..");
const [name, ...flags] = process.argv.slice(2);
if (!name) {
  console.error("usage: node perf-bench/build.mjs <name> [--no-minify]");
  process.exit(2);
}
const outDir = path.join(here, "builds", name);
const args = [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  path.join(root, "playground", "vite.config.mts"),
  "--outDir",
  outDir,
  "--emptyOutDir",
  "--logLevel",
  "warn",
];
if (flags.includes("--no-minify")) {
  args.push("--minify", "false");
}
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`built ${outDir}`);
