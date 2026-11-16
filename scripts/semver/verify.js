const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync } = require("child_process");

const { buildSync } = require("esbuild");

const {
  LOCKSTEP,
  registryName,
  registryTarball,
  sourceName,
  urlTarball,
} = require("./packages");

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "release");
const FIXTURE = path.join(__dirname, "consumer");
const THEMES_INDEX = path.join(ROOT, "packages/excalidraw/themes/index.json");
const NODE_LOADABLE = ["common", "fractional-indexing", "math", "element"];

const fileSpec = (file) => `file:${file.split(path.sep).join("/")}`;

// Each channel is one way a consumer gets the packages. GitHub Packages
// tarballs reach their siblings through npm aliases, which overrides point at
// the local registry tarballs. A release asset bundles its siblings.
const channels = (version) => {
  const registry = (id) =>
    path.join(OUT_DIR, "registry", registryTarball(id, version));
  return [
    {
      label: "GitHub Packages",
      tarball: (id) => registryTarball(id, version),
      expectedName: registryName,
      manifest: (id) => ({
        dependencies: { [sourceName(id)]: fileSpec(registry(id)) },
        overrides: Object.fromEntries(
          LOCKSTEP.filter((other) => other !== id).map((other) => [
            sourceName(other),
            fileSpec(registry(other)),
          ]),
        ),
      }),
    },
    {
      label: "release asset",
      tarball: (id) => urlTarball(id, version),
      expectedName: sourceName,
      manifest: (id) => ({
        dependencies: {
          [sourceName(id)]: fileSpec(
            path.join(OUT_DIR, urlTarball(id, version)),
          ),
        },
      }),
    },
  ];
};

const install = (work, name, manifest, extra = []) => {
  const project = fs.mkdtempSync(path.join(work, `${name}-`));
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ private: true, type: "module", ...manifest }),
  );
  execSync(
    `npm install --no-audit --no-fund --ignore-scripts --loglevel=error ${extra.join(
      " ",
    )}`,
    { cwd: project, stdio: "inherit" },
  );
  return project;
};

// Where the editor's own imports resolve: a bundled copy first, then hoisted.
const installedManifest = (project, id) => {
  const modules = path.join(project, "node_modules");
  const file = [
    path.join(
      modules,
      sourceName("excalidraw"),
      "node_modules",
      sourceName(id),
    ),
    path.join(modules, sourceName(id)),
  ]
    .map((dir) => path.join(dir, "package.json"))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) {
    throw new Error(`${sourceName(id)} is not installed in ${project}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8"));
};

const verifyInstalled = (project, channel, version) => {
  for (const id of LOCKSTEP) {
    const { name, version: installed } = installedManifest(project, id);
    if (name !== channel.expectedName(id) || installed !== version) {
      throw new Error(
        `${sourceName(id)} from the ${
          channel.label
        } tarballs installs as ${name}@${installed}, not ${channel.expectedName(
          id,
        )}@${version}`,
      );
    }
  }
};

// Vite resolves the development condition in its dev server and production in
// a build. Each points at its own dist, so both have to bundle.
const MODES = ["development", "production"];

const bundle = (project, mode, options, failure) => {
  try {
    buildSync({
      absWorkingDir: project,
      bundle: true,
      conditions: [mode],
      define: {
        "import.meta.env.DEV": String(mode === "development"),
        "import.meta.env.PROD": String(mode === "production"),
      },
      logLevel: "error",
      ...options,
    });
  } catch {
    throw new Error(failure);
  }
};

// The same calls typecheck-consumer.js checks, now against the JavaScript.
// esbuild fails on a named import the bundle does not export.
const verifyBundles = (project, channel) => {
  fs.cpSync(FIXTURE, project, { recursive: true });
  for (const mode of MODES) {
    bundle(
      project,
      mode,
      {
        entryPoints: ["bundle.ts"],
        format: "esm",
        outdir: `out-${mode}`,
        loader: { ".woff2": "file" },
      },
      `a bundler cannot build draw's imports from ${channel.tarball(
        "excalidraw",
      )} installed alone, under the ${mode} condition`,
    );
  }
};

// A worker spawned from `new URL("./…", import.meta.url)` loads only if the
// file it names ships beside the script that names it.
const verifyWorkerUrls = (project, channel) => {
  const dist = path.join(
    project,
    "node_modules",
    sourceName("excalidraw"),
    "dist",
  );
  const scripts = fs
    .readdirSync(dist, { recursive: true })
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join(dist, file));
  const urls = scripts.flatMap((script) =>
    [
      ...fs
        .readFileSync(script, "utf-8")
        .matchAll(/new URL\(["'](\.{1,2}\/[^"']+)["'],\s*import\.meta\.url\)/g),
    ].map(([, url]) => ({ script, url })),
  );
  const missing = urls.filter(
    ({ script, url }) =>
      !fs.existsSync(path.resolve(path.dirname(script), url)),
  );
  if (!urls.length || missing.length) {
    throw new Error(
      `${channel.tarball("excalidraw")} ${
        urls.length
          ? `names files it does not ship: ${missing
              .map(
                ({ script, url }) => `${url} in ${path.relative(dist, script)}`,
              )
              .join(", ")}`
          : "names no worker by URL, so this check reads the wrong pattern"
      }`,
    );
  }
  return urls.length;
};

// draw imports the sample themes as text at build time through ./themes/*.
const themeFiles = () => {
  const { themes } = JSON.parse(fs.readFileSync(THEMES_INDEX, "utf-8"));
  return [
    "index.json",
    "tokens.schema.json",
    ...themes.flatMap(({ name, generated }) =>
      generated ? [`${name}.css`, `${name}.tokens.json`] : [`${name}.css`],
    ),
  ];
};

const verifyThemesImport = (project, channel, files) => {
  fs.writeFileSync(
    path.join(project, "themes.js"),
    `${files
      .map(
        (file, i) =>
          `import file${i} from "@excalidraw/excalidraw/themes/${file}";`,
      )
      .join("\n")}\nexport default [${files.map((_, i) => `file${i}`)}];\n`,
  );
  const failure = `a bundler cannot import every file themes/index.json lists from ${channel.tarball(
    "excalidraw",
  )}`;
  bundle(
    project,
    "production",
    {
      entryPoints: ["themes.js"],
      format: "cjs",
      outfile: "themes.cjs",
      loader: { ".css": "text" },
    },
    failure,
  );
  const imported = require(path.join(project, "themes.cjs")).default;
  files.forEach((file, i) => {
    const isCss = file.endsWith(".css");
    const ok = isCss
      ? typeof imported[i] === "string" && imported[i].length > 0
      : typeof imported[i] === "object" && imported[i] !== null;
    if (!ok) {
      throw new Error(
        `themes/${file} in ${channel.tarball(
          "excalidraw",
        )} does not import as ${isCss ? "text" : "JSON"}`,
      );
    }
  });
};

const verifyLoadsInNode = (project, id, channel) => {
  try {
    execSync(
      `node --input-type=module -e "await import('${sourceName(id)}')"`,
      { cwd: project, stdio: "inherit" },
    );
  } catch {
    throw new Error(
      `${sourceName(id)} from ${channel.tarball(
        id,
      )} does not load on its own in Node`,
    );
  }
};

const verify = ({ version }) => {
  const themes = themeFiles();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "semver-verify-"));
  try {
    for (const channel of channels(version)) {
      const editor = install(
        work,
        "excalidraw",
        channel.manifest("excalidraw"),
        ["react@19", "react-dom@19"],
      );
      verifyInstalled(editor, channel, version);
      verifyBundles(editor, channel);
      console.info(
        `${channel.label}: ${channel.tarball(
          "excalidraw",
        )} installs alone at ${version} and bundles draw's imports for ${MODES.join(
          " and ",
        )}`,
      );
      const workerUrls = verifyWorkerUrls(editor, channel);
      console.info(
        `${channel.label}: the ${workerUrls} worker URLs in ${channel.tarball(
          "excalidraw",
        )} name files it ships`,
      );
      verifyThemesImport(editor, channel, themes);
      console.info(
        `${channel.label}: ${themes.length} files from themes/index.json import through ./themes/*`,
      );
      for (const id of NODE_LOADABLE) {
        verifyLoadsInNode(install(work, id, channel.manifest(id)), id, channel);
        console.info(
          `${channel.label}: ${sourceName(id)} loads on its own in Node`,
        );
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

if (require.main === module) {
  const version = process.argv
    .find((argument) => argument.startsWith("--version="))
    ?.split("=")[1];
  if (!version) {
    console.error("Usage: node scripts/semver/verify.js --version=1.0.0");
    process.exit(1);
  }
  try {
    verify({ version });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
