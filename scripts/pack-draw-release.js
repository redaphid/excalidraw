const fs = require("fs");
const path = require("path");

const { execSync } = require("child_process");

const { atVersion, LOCKSTEP } = require("./semver/packages");
const { pack } = require("./semver/pack");

const PACKAGES_DIR = path.resolve(__dirname, "../packages");

const version = process.argv
  .find((argument) => argument.startsWith("--version="))
  ?.split("=")[1];

if (!version) {
  console.error(
    "Usage: node scripts/pack-draw-release.js --version=0.19.0-draw.N",
  );
  process.exit(1);
}

for (const id of LOCKSTEP) {
  const file = path.resolve(PACKAGES_DIR, id, "package.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf-8"));
  fs.writeFileSync(
    file,
    `${JSON.stringify(atVersion(manifest, version), null, 2)}\n`,
    "utf-8",
  );
}

execSync("yarn --frozen-lockfile", { stdio: "inherit" });
pack({ version });
