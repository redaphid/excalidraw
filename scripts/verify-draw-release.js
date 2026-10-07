const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync } = require("child_process");

const { buildSync } = require("esbuild");

const PACKAGES = [
  "common",
  "fractional-indexing",
  "math",
  "element",
  "excalidraw",
];
const NODE_LOADABLE = ["common", "fractional-indexing", "math"];

const option = (name) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.split("=")[1];

const version = option("version");
const releaseDir = path.resolve(
  option("dir") ?? path.resolve(__dirname, "../release"),
);

if (!version) {
  console.error(
    "Usage: node scripts/verify-draw-release.js --version=0.19.0-draw.N [--dir=release]",
  );
  process.exit(1);
}

const fail = (message) => {
  console.error(`verify-draw-release: ${message}`);
  process.exit(1);
};

const tarball = (packageName) =>
  path.join(releaseDir, `excalidraw-${packageName}-${version}.tgz`);

const consumerProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draw-release-consumer-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  return dir;
};

const npmInstall = (dir, specs) =>
  execSync(
    `npm install --no-audit --no-fund --ignore-scripts ${specs
      .map((spec) => JSON.stringify(spec))
      .join(" ")}`,
    { cwd: dir, stdio: "inherit" },
  );

const verifyTarballNames = () => {
  const expected = PACKAGES.map((name) => path.basename(tarball(name))).sort();
  const found = fs
    .readdirSync(releaseDir)
    .filter((file) => file.endsWith(".tgz"))
    .sort();
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    fail(
      `expected ${expected.join(", ")} in ${releaseDir}, found ${
        found.join(", ") || "no tarballs"
      }`,
    );
  }
};

const verifyExcalidrawInstallsAlone = () => {
  const drawApp = consumerProject();
  npmInstall(drawApp, [tarball("excalidraw"), "react@19", "react-dom@19"]);
  const installed = JSON.parse(
    fs.readFileSync(
      path.join(drawApp, "node_modules/@excalidraw/excalidraw/package.json"),
      "utf-8",
    ),
  );
  if (installed.version !== version) {
    fail(`installed @excalidraw/excalidraw is ${installed.version}`);
  }
  fs.writeFileSync(
    path.join(drawApp, "entry.js"),
    'import { Excalidraw } from "@excalidraw/excalidraw";\nconsole.log(Excalidraw);\n',
  );
  try {
    buildSync({
      absWorkingDir: drawApp,
      entryPoints: ["entry.js"],
      bundle: true,
      format: "esm",
      outdir: "out",
      loader: { ".woff2": "file" },
      define: {
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
      },
      logLevel: "error",
    });
  } catch {
    fail(
      `a bundler cannot resolve every import of excalidraw-excalidraw-${version}.tgz installed alone`,
    );
  }
  console.info(
    `verify-draw-release: a bundler resolves every import of excalidraw-excalidraw-${version}.tgz installed alone`,
  );
};

const verifyLoadsAloneInNode = (packageName) => {
  const project = consumerProject();
  npmInstall(project, [tarball(packageName)]);
  try {
    execSync(
      `node --input-type=module -e "await import('@excalidraw/${packageName}')"`,
      { cwd: project, stdio: "inherit" },
    );
  } catch {
    fail(`@excalidraw/${packageName} does not load on its own in Node`);
  }
  console.info(
    `verify-draw-release: @excalidraw/${packageName} loads on its own in Node`,
  );
};

verifyTarballNames();
verifyExcalidrawInstallsAlone();
NODE_LOADABLE.forEach(verifyLoadsAloneInNode);
