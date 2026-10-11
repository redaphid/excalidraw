const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildSync } = require("esbuild");

const {
  LOCKSTEP,
  registryName,
  registryTarball,
  sourceName,
  urlTarball,
} = require("./packages");

const ROOT = path.resolve(__dirname, "../..");
const THEMES_INDEX = path.join(ROOT, "packages/excalidraw/themes/index.json");
const NODE_LOADABLE = ["common", "fractional-indexing", "math", "element"];

const fileSpec = (file) => `file:${file.split(path.sep).join("/")}`;

// Each channel is how a consumer gets the packages: GitHub Packages, where the
// siblings arrive through their npm aliases (overrides stand in for the
// registry), or a release asset URL, which bundles its siblings.
const channels = (version, dir) => {
  const registry = (id) =>
    path.join(dir, "registry", registryTarball(id, version));
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
          [sourceName(id)]: fileSpec(path.join(dir, urlTarball(id, version))),
        },
      }),
    },
  ];
};

const verifyTarballNames = (version, dir) => {
  const expect = (folder, names) => {
    const found = fs
      .readdirSync(folder)
      .filter((file) => file.endsWith(".tgz"))
      .sort();
    const expected = [...names].sort();
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      throw new Error(
        `expected ${expected.join(", ")} in ${folder}, found ${
          found.join(", ") || "no tarballs"
        }`,
      );
    }
  };
  expect(
    dir,
    LOCKSTEP.map((id) => urlTarball(id, version)),
  );
  expect(
    path.join(dir, "registry"),
    LOCKSTEP.map((id) => registryTarball(id, version)),
  );
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

const verifyInstalled = (project, ids, channel, version) => {
  for (const id of ids) {
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

const verifyBundles = (project, channel) => {
  fs.writeFileSync(
    path.join(project, "entry.js"),
    'import { Excalidraw } from "@excalidraw/excalidraw";\nconsole.log(Excalidraw);\n',
  );
  try {
    buildSync({
      absWorkingDir: project,
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
    throw new Error(
      `a bundler cannot resolve every import of ${channel.tarball(
        "excalidraw",
      )} installed alone`,
    );
  }
};

// draw serves the sample themes as MCP resources, importing them as text at
// build time through the package's ./themes/* export.
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
  let imported;
  try {
    buildSync({
      absWorkingDir: project,
      entryPoints: ["themes.js"],
      bundle: true,
      format: "cjs",
      outfile: "themes.cjs",
      loader: { ".css": "text" },
      logLevel: "error",
    });
    imported = require(path.join(project, "themes.cjs")).default;
  } catch {
    throw new Error(
      `a bundler cannot import every file themes/index.json lists from ${channel.tarball(
        "excalidraw",
      )}`,
    );
  }
  files.forEach((file, i) => {
    const isCss = file.endsWith(".css");
    const ok = isCss
      ? typeof imported[i] === "string" && imported[i].startsWith("/* ")
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

const verify = ({ version, dir }) => {
  verifyTarballNames(version, dir);
  const themes = fs.existsSync(THEMES_INDEX) ? themeFiles() : null;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "semver-verify-"));
  try {
    for (const channel of channels(version, dir)) {
      const editor = install(
        work,
        "excalidraw",
        channel.manifest("excalidraw"),
        ["react@19", "react-dom@19"],
      );
      verifyInstalled(editor, LOCKSTEP, channel, version);
      verifyBundles(editor, channel);
      console.info(
        `${channel.label}: ${channel.tarball(
          "excalidraw",
        )} installs alone at ${version} and bundles`,
      );
      if (themes) {
        verifyThemesImport(editor, channel, themes);
        console.info(
          `${channel.label}: ${themes.length} files from themes/index.json import through ./themes/*`,
        );
      } else {
        console.info(
          `${channel.label}: no packages/excalidraw/themes/index.json, skipping the theme imports`,
        );
      }
      for (const id of NODE_LOADABLE) {
        const project = install(work, id, channel.manifest(id));
        verifyLoadsInNode(project, id, channel);
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
    verify({ version, dir: path.join(ROOT, "release") });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { verify };
