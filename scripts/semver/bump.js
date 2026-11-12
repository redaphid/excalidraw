const fs = require("fs");
const path = require("path");

const { atVersion, LOCKSTEP } = require("./packages");

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/semver/bump.js 1.2.3");
  process.exit(1);
}

for (const id of LOCKSTEP) {
  const file = path.resolve(__dirname, "../../packages", id, "package.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf-8"));
  fs.writeFileSync(
    file,
    `${JSON.stringify(atVersion(manifest, version), null, 2)}\n`,
  );
}
