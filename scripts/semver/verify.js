const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync, spawn, spawnSync } = require("child_process");
const { createRequire } = require("module");

const { buildSync } = require("esbuild");

const {
  consumerNpmrc,
  LOCKSTEP,
  registryName,
  siblingClosure,
  sourceName,
} = require("./packages");

const NODE_LOADABLE = ["common", "fractional-indexing", "math"];

const option = (name) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const version = option("version");
const registry = option("registry");
const releaseDir = path.resolve(
  option("dir") ?? path.resolve(__dirname, "../../release"),
);

if (!version) {
  console.error(
    "Usage: node scripts/semver/verify.js --version=1.0.0 [--dir=release] [--registry=https://npm.pkg.github.com]",
  );
  process.exit(1);
}

const fail = (message) => {
  console.error(`semver-verify: ${message}`);
  process.exit(1);
};

const passed = (message) => console.info(`semver-verify: ${message}`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

const consumerProject = (dependencies) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "semver-consumer-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  );
  return dir;
};

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

const EXCALIDRAW_CLOSURE = siblingClosure(
  "excalidraw",
  Object.fromEntries(
    LOCKSTEP.map((id) => [
      id,
      readJson(path.resolve(__dirname, "../../packages", id, "package.json")),
    ]),
  ),
);

const PNPM = "npx --yes pnpm@10.33.0 install --ignore-scripts --no-frozen-lockfile";

// Upstream's packages import each other's types in a cycle: common and
// element reach excalidraw's types, which import jotai and roughjs, which
// neither declares. Only a layout that hoists can resolve those, so
// pnpm-strict reports its type gaps without failing.
const MANAGERS = {
  npm: {
    install: "npm install --no-audit --no-fund --ignore-scripts",
    config: {},
    typesResolve: true,
  },
  pnpm: { install: PNPM, config: {}, typesResolve: true },
  "pnpm-strict": {
    install: PNPM,
    config: { hoist: "false" },
    typesResolve: false,
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

const TSC = require.resolve("typescript/bin/tsc");

// A declaration import that resolves to nothing turns its types into any
// without an error under skipLibCheck, so the check turns it off. It fails on
// any error in the consumer's own file, and on any unresolved module in the
// fork's packages except upstream's JSON locale import, which tsc never emits.
const UNRESOLVED =
  /^(?:\S*\/)?node_modules\/(?:\S*\/)?@(?:excalidraw|redaphid)\/\S+: error TS2307: Cannot find module '(?![^']*\.json')/;

const typeProblems = (dir, specifier) => {
  fs.writeFileSync(
    path.join(dir, "check.ts"),
    [
      `import type { ExcalidrawProps } from "${specifier}/types";`,
      `import type { ExcalidrawElement } from "${specifier}/element/types";`,
      "type IsAny<T> = 0 extends 1 & T ? true : false;",
      "export const props: IsAny<ExcalidrawProps> = false;",
      "export const element: IsAny<ExcalidrawElement> = false;",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        skipLibCheck: false,
      },
      files: ["check.ts"],
    }),
  );
  const result = spawnSync(process.execPath, [TSC, "-p", dir], {
    cwd: dir,
    encoding: "utf-8",
  });
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("check.ts") || UNRESOLVED.test(line));
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
    {
      [style.name]: style.specifier,
      react: "19",
      "react-dom": "19",
      "@types/react": "19",
      "@types/react-dom": "19",
    },
    target,
  );
  const published = `${registryName("excalidraw")}@${version}`;

  if (!bundles(dir, style.name)) {
    fail(
      `${label}: bundle: a bundler cannot resolve every import of ${published}`,
    );
  }
  passed(`${label}: a bundler resolves every import of ${published}`);

  const problems = typeProblems(dir, style.name);
  if (problems.length === 0) {
    passed(`${label}: tsc resolves every declaration import of ${published}`);
  } else if (MANAGERS[managerName].typesResolve) {
    fail(
      `${label}: types: ${published}'s types do not resolve:\n${problems.join(
        "\n",
      )}`,
    );
  } else {
    console.info(
      `semver-verify: ${label}: known gap: ${problems.length} declaration imports do not resolve without hoisting`,
    );
  }

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

const startLocalRegistry = (authToken) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve(__dirname, "local-registry.js"),
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
  const authToken = crypto.randomBytes(16).toString("hex");
  verifyRegistry({
    url: await startLocalRegistry(authToken),
    token: authToken,
  });
};

main().catch((error) => fail(error.message));
