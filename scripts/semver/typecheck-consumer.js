const fs = require("fs");
const path = require("path");

const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "release");
const FIXTURE = path.join(__dirname, "consumer");
const CONSUMER = path.join(OUT_DIR, "consumer");

// The packages draw installs. Each URL tarball bundles its own siblings, so
// this is the tree pnpm builds from them.
const INSTALLED = ["common", "element", "excalidraw"];

const typecheckConsumer = ({ version }) => {
  fs.rmSync(CONSUMER, { recursive: true, force: true });
  fs.cpSync(FIXTURE, CONSUMER, { recursive: true });
  for (const id of INSTALLED) {
    const into = path.join(CONSUMER, "node_modules", "@excalidraw", id);
    fs.mkdirSync(into, { recursive: true });
    // Relative names only: Git for Windows' GNU tar reads "D:\..." as a host.
    execSync(
      `tar -xzf excalidraw-${id}-${version}.tgz --strip-components=1 -C ${path
        .relative(OUT_DIR, into)
        .split(path.sep)
        .join("/")}`,
      { cwd: OUT_DIR },
    );
  }
  execSync(`yarn tsc -p ${path.join(CONSUMER, "tsconfig.json")}`, {
    cwd: ROOT,
    stdio: "inherit",
  });
};

if (require.main === module) {
  const version = process.argv
    .find((argument) => argument.startsWith("--version="))
    ?.split("=")[1];
  if (!version) {
    console.error(
      "Usage: node scripts/semver/typecheck-consumer.js --version=1.0.0",
    );
    process.exit(1);
  }
  typecheckConsumer({ version });
}
