const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync } = require("child_process");

const {
  atVersion,
  declarationTarget,
  LOCKSTEP,
  registryManifest,
  siblingClosure,
  sourceName,
  urlManifest,
} = require("./packages");

const ROOT = path.resolve(__dirname, "../..");
const PACKAGES_DIR = path.join(ROOT, "packages");
const OUT_DIR = path.join(ROOT, "release");
const REGISTRY_DIR = path.join(OUT_DIR, "registry");

const urlTarball = (id, version) => `excalidraw-${id}-${version}.tgz`;
const registryTarball = (id, version) =>
  `redaphid-excalidraw-${id}-${version}.tgz`;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

const writeJson = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");

// macOS tar otherwise adds an AppleDouble ._ file beside every packed file.
const ENV = { ...process.env, COPYFILE_DISABLE: "1" };

// tar only ever sees relative archive names: Git for Windows' GNU tar reads
// "D:\..." as a remote host.
const tar = (args, cwd) => execSync(`tar ${args}`, { cwd, env: ENV });

const SPECIFIER = /(\bfrom\s+|\bimport\(\s*)"(@excalidraw\/[^"]+)"/g;

const declarationFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((file) => file.endsWith(".d.ts"))
    .map((file) => path.join(dir, file));

const localizeDeclarations = (dir, id, manifest) => {
  const types = path.join(dir, "dist", "types");
  const declared = Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  });
  const resolve = (target) =>
    [`${target}.d.ts`, `${target}/index.d.ts`]
      .map((candidate) => path.join(types, candidate))
      .find((file) => fs.existsSync(file));
  for (const file of declarationFiles(types)) {
    const source = fs.readFileSync(file, "utf-8");
    const localized = source.replace(SPECIFIER, (whole, prefix, specifier) => {
      const target = declarationTarget(specifier, id, declared);
      const resolved = target && resolve(target);
      if (!resolved) {
        return whole;
      }
      const relative = path
        .relative(path.dirname(file), resolved.replace(/\.d\.ts$/, ""))
        .split(path.sep)
        .join("/");
      return `${prefix}"${
        relative.startsWith(".") ? relative : `./${relative}`
      }"`;
    });
    if (localized !== source) {
      fs.writeFileSync(file, localized);
    }
  }
};

const pack = ({ version }) => {
  const unversioned = LOCKSTEP.filter(
    (id) =>
      readJson(path.join(PACKAGES_DIR, id, "package.json")).version !== version,
  );
  if (unversioned.length > 0) {
    throw new Error(
      `${unversioned.join(
        ", ",
      )} not at ${version}. Run node scripts/semver/bump.js ${version} and commit it first.`,
    );
  }
  const sha = execSync("git rev-parse HEAD", {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim();

  execSync("yarn rm:build", { cwd: ROOT, env: ENV, stdio: "inherit" });
  for (const id of LOCKSTEP) {
    execSync("yarn run build:esm", {
      cwd: path.join(PACKAGES_DIR, id),
      env: ENV,
      stdio: "inherit",
    });
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-pack-"));
  const unpacked = (id) => path.join(work, "packed", id);
  for (const id of LOCKSTEP) {
    execSync(`yarn pack --filename ${path.join(work, `${id}.tgz`)}`, {
      cwd: path.join(PACKAGES_DIR, id),
      env: ENV,
      stdio: "inherit",
    });
    fs.mkdirSync(unpacked(id), { recursive: true });
    tar(`-xzf ${id}.tgz --strip-components=1 -C packed/${id}`, work);
    localizeDeclarations(
      unpacked(id),
      id,
      readJson(path.join(unpacked(id), "package.json")),
    );
  }
  const packed = Object.fromEntries(
    LOCKSTEP.map((id) => [
      id,
      readJson(path.join(unpacked(id), "package.json")),
    ]),
  );

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });

  for (const id of LOCKSTEP) {
    const siblings = siblingClosure(id, packed);

    const urlStaging = path.join(work, "url", id, "package");
    fs.cpSync(unpacked(id), urlStaging, { recursive: true });
    writeJson(
      path.join(urlStaging, "package.json"),
      urlManifest(packed, id, version, siblings),
    );
    for (const sibling of siblings) {
      const bundled = path.join(
        urlStaging,
        "node_modules",
        sourceName(sibling),
      );
      fs.cpSync(unpacked(sibling), bundled, { recursive: true });
      writeJson(
        path.join(bundled, "package.json"),
        atVersion(packed[sibling], version),
      );
    }
    tar(`-czf ${urlTarball(id, version)} package`, path.dirname(urlStaging));
    fs.copyFileSync(
      path.join(path.dirname(urlStaging), urlTarball(id, version)),
      path.join(OUT_DIR, urlTarball(id, version)),
    );

    const registryStaging = path.join(work, "registry", id);
    fs.cpSync(unpacked(id), registryStaging, { recursive: true });
    writeJson(
      path.join(registryStaging, "package.json"),
      registryManifest(packed, id, version, sha, siblings),
    );
    const [{ filename }] = JSON.parse(
      execSync(
        `npm pack ${registryStaging} --pack-destination ${REGISTRY_DIR} --ignore-scripts --json`,
        { env: ENV, encoding: "utf-8" },
      ),
    );
    fs.renameSync(
      path.join(REGISTRY_DIR, filename),
      path.join(REGISTRY_DIR, registryTarball(id, version)),
    );
  }
  fs.rmSync(work, { recursive: true, force: true });
};

if (require.main === module) {
  const version = process.argv
    .find((argument) => argument.startsWith("--version="))
    ?.split("=")[1];
  if (!version) {
    console.error("Usage: node scripts/semver/pack.js --version=1.0.0");
    process.exit(1);
  }
  pack({ version });
}

module.exports = { pack };
