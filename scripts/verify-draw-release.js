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
  return drawApp;
};

// draw serves the sample themes as MCP resources, importing them as text at
// build time through the package's exports
const verifyThemesImportAsText = (drawApp) => {
  const { themes } = JSON.parse(
    fs.readFileSync(
      path.join(
        drawApp,
        "node_modules/@excalidraw/excalidraw/themes/index.json",
      ),
      "utf-8",
    ),
  );
  const files = [
    "index.json",
    "tokens.schema.json",
    ...themes.flatMap(({ name, generated }) =>
      generated ? [`${name}.css`, `${name}.tokens.json`] : [`${name}.css`],
    ),
  ];
  fs.writeFileSync(
    path.join(drawApp, "themes.js"),
    `${files
      .map(
        (file, i) =>
          `import file${i} from "@excalidraw/excalidraw/themes/${file}";`,
      )
      .join("\n")}\nexport default [${files.map((_, i) => `file${i}`)}];\n`,
  );
  let imported;
  try {
    buildSync({
      absWorkingDir: drawApp,
      entryPoints: ["themes.js"],
      bundle: true,
      format: "cjs",
      outfile: "themes.cjs",
      loader: { ".css": "text" },
      logLevel: "error",
    });
    imported = require(path.join(drawApp, "themes.cjs")).default;
  } catch {
    fail(`a bundler cannot import every file themes/index.json lists`);
  }
  files.forEach((file, i) => {
    const ok = file.endsWith(".css")
      ? typeof imported[i] === "string" && imported[i].startsWith("/* ")
      : typeof imported[i] === "object" && imported[i] !== null;
    if (!ok) {
      fail(
        `themes/${file} does not import as ${
          file.endsWith(".css") ? "text" : "JSON"
        }`,
      );
    }
  });
  console.info(
    `verify-draw-release: ${themes.length} themes and ${files.length} theme files import from excalidraw-excalidraw-${version}.tgz`,
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
verifyThemesImportAsText(verifyExcalidrawInstallsAlone());
NODE_LOADABLE.forEach(verifyLoadsAloneInNode);
