const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync, spawn } = require("child_process");
const { createRequire } = require("module");

const { buildSync } = require("esbuild");

const {
  consumerNpmrc,
  LOCKSTEP,
  registryName,
  siblingClosure,
  sourceName,
} = require("./semver/packages");

const NODE_LOADABLE = ["common", "fractional-indexing", "math"];

const option = (name) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const version = option("version");
const registry = option("registry");
const releaseDir = path.resolve(
  option("dir") ?? path.resolve(__dirname, "../release"),
);

if (!version) {
  console.error(
    "Usage: node scripts/verify-draw-release.js --version=0.19.0-draw.N [--dir=release] [--registry=https://npm.pkg.github.com]",
  );
  process.exit(1);
}

const fail = (message) => {
  console.error(`verify-draw-release: ${message}`);
  process.exit(1);
};

const passed = (message) => console.info(`verify-draw-release: ${message}`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

const tarball = (packageName) =>
  path.join(releaseDir, `excalidraw-${packageName}-${version}.tgz`);

const consumerProject = (dependencies) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draw-release-consumer-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
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

const bundles = (dir, specifier) => {
  fs.writeFileSync(
    path.join(dir, "entry.js"),
    `import { Excalidraw } from "${specifier}";\nconsole.log(Excalidraw);\n`,
  );
  try {
    buildSync({
      absWorkingDir: dir,
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
    return true;
  } catch {
    return false;
  }
};

const verifyTarballNames = () => {
  const expected = LOCKSTEP.map((name) => path.basename(tarball(name))).sort();
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
  const installed = readJson(
    path.join(drawApp, "node_modules/@excalidraw/excalidraw/package.json"),
  );
  if (installed.version !== version) {
    fail(`installed @excalidraw/excalidraw is ${installed.version}`);
  }
  if (!bundles(drawApp, "@excalidraw/excalidraw")) {
    fail(
      `a bundler cannot resolve every import of excalidraw-excalidraw-${version}.tgz installed alone`,
    );
  }
  passed(
    `a bundler resolves every import of excalidraw-excalidraw-${version}.tgz installed alone`,
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
  passed(`@excalidraw/${packageName} loads on its own in Node`);
};

// Read from the source tree, so the check never trusts the manifests it tests.
const EXCALIDRAW_CLOSURE = siblingClosure(
  "excalidraw",
  Object.fromEntries(
    LOCKSTEP.map((id) => [
      id,
      readJson(path.resolve(__dirname, "../packages", id, "package.json")),
    ]),
  ),
);

// Each config entry goes on the command line and into .npmrc, so neither a
// global pnpm config nor a stray flag decides the layout under test.
const MANAGERS = {
  npm: {
    install: "npm install --no-audit --no-fund --ignore-scripts",
    config: {},
  },
  "pnpm-strict": {
    install:
      "npx --yes pnpm@10.33.0 install --ignore-scripts --no-frozen-lockfile",
    config: { hoist: "false" },
  },
};

const STYLES = {
  scoped: { name: registryName("excalidraw"), specifier: version },
  alias: {
    name: sourceName("excalidraw"),
    specifier: `npm:${registryName("excalidraw")}@${version}`,
  },
};

const registryConsumer = (label, managerName, dependencies, target) => {
  const manager = MANAGERS[managerName];
  const dir = consumerProject(dependencies);
  const config = Object.entries(manager.config);
  fs.writeFileSync(
    path.join(dir, ".npmrc"),
    `${consumerNpmrc(target.url)}${config
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")}`,
  );
  try {
    execSync(
      `${manager.install}${config
        .map(([key, value]) => ` --config.${key}=${value}`)
        .join("")}`,
      {
        cwd: dir,
        stdio: "inherit",
        env: { ...process.env, NODE_AUTH_TOKEN: target.token },
      },
    );
  } catch {
    fail(
      `${label}: install: ${Object.keys(dependencies).join(
        ", ",
      )} did not install`,
    );
  }
  return dir;
};

const resolvedSibling = (from, sibling) => {
  const found = createRequire(path.join(from, "package.json"))
    .resolve.paths(sourceName(sibling))
    .map((dir) => path.join(dir, sourceName(sibling), "package.json"))
    .find((file) => fs.existsSync(file));
  return found && readJson(found);
};

const verifyRegistryConsumer = (managerName, styleName, target) => {
  const label = `${managerName}/${styleName}`;
  const style = STYLES[styleName];
  const dir = registryConsumer(
    label,
    managerName,
    { [style.name]: style.specifier, react: "19", "react-dom": "19" },
    target,
  );
  const published = `${registryName("excalidraw")}@${version}`;

  if (!bundles(dir, style.name)) {
    fail(
      `${label}: bundle: a bundler cannot resolve every import of ${published}`,
    );
  }
  passed(`${label}: a bundler resolves every import of ${published}`);

  const excalidraw = fs.realpathSync(
    path.join(dir, "node_modules", style.name),
  );
  for (const sibling of EXCALIDRAW_CLOSURE) {
    const manifest = resolvedSibling(excalidraw, sibling);
    if (
      manifest?.name !== registryName(sibling) ||
      manifest.version !== version
    ) {
      fail(
        `${label}: identity: ${sourceName(sibling)} resolves to ${
          manifest ? `${manifest.name}@${manifest.version}` : "nothing"
        } from ${published}, not ${registryName(sibling)}@${version}`,
      );
    }
  }
  passed(
    `${label}: ${EXCALIDRAW_CLOSURE.map(sourceName).join(
      ", ",
    )} resolve to @redaphid/* at ${version} from ${published}`,
  );

  if (managerName === "pnpm-strict") {
    if (fs.existsSync(path.join(dir, "node_modules/.pnpm/node_modules"))) {
      fail(
        `${label}: pnpm teeth: pnpm hoisted packages into node_modules/.pnpm/node_modules`,
      );
    }
    passed(
      `${label}: pnpm hoisted nothing into node_modules/.pnpm/node_modules`,
    );
  }
};

const verifyRegistryLoadsInNode = (managerName, target) => {
  const dir = registryConsumer(
    managerName,
    managerName,
    Object.fromEntries(NODE_LOADABLE.map((id) => [registryName(id), version])),
    target,
  );
  for (const id of NODE_LOADABLE) {
    try {
      execSync(
        `node --input-type=module -e "await import('${registryName(id)}')"`,
        { cwd: dir, stdio: "inherit" },
      );
    } catch {
      fail(
        `${managerName}: node-load: ${registryName(
          id,
        )}@${version} does not load in Node`,
      );
    }
    passed(`${managerName}: ${registryName(id)}@${version} loads in Node`);
  }
};

const verifyRegistry = (target) => {
  for (const managerName of Object.keys(MANAGERS)) {
    for (const styleName of Object.keys(STYLES)) {
      verifyRegistryConsumer(managerName, styleName, target);
    }
    verifyRegistryLoadsInNode(managerName, target);
  }
};

// The installs run through execSync, which blocks this event loop, so the
// registry has to live in its own process.
const startLocalRegistry = (authToken) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve(__dirname, "semver/local-registry.js"),
        `--dir=${path.join(releaseDir, "registry")}`,
        `--token=${authToken}`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    process.on("exit", () => child.kill());
    child.on("exit", (code) =>
      reject(new Error(`the local registry exited with ${code}`)),
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const ready = output.match(/^READY (\S+)$/m);
      if (ready) {
        child.stdout.destroy();
        child.unref();
        resolve(ready[1]);
      }
    });
  });

const main = async () => {
  if (registry) {
    const authToken = process.env.GITHUB_TOKEN;
    if (!authToken) {
      fail(
        `--registry=${registry} reads its token from GITHUB_TOKEN, which is unset`,
      );
    }
    verifyRegistry({ url: registry, token: authToken });
    return;
  }
  verifyTarballNames();
  verifyExcalidrawInstallsAlone();
  NODE_LOADABLE.forEach(verifyLoadsAloneInNode);
  const authToken = crypto.randomBytes(16).toString("hex");
  verifyRegistry({
    url: await startLocalRegistry(authToken),
    token: authToken,
  });
};

main().catch((error) => fail(error.message));
