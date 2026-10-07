const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync } = require("child_process");

const {
  atVersion,
  LOCKSTEP,
  registryManifest,
  registryName,
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

const sha512 = (file) =>
  crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");

// tar only ever sees relative archive names: Git for Windows' GNU tar reads
// "D:\..." as a remote host.
const tar = (args, cwd) => execSync(`tar ${args}`, { cwd });

const pack = ({ version }) => {
  const sha = execSync("git rev-parse HEAD", {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim();
  // macOS tar otherwise adds an AppleDouble ._ file beside every packed file.
  const env = {
    ...process.env,
    COPYFILE_DISABLE: "1",
    EXCALIDRAW_RELEASE_VERSION: version,
  };

  execSync("yarn rm:build", { cwd: ROOT, env, stdio: "inherit" });
  for (const id of LOCKSTEP) {
    execSync("yarn run build:esm", {
      cwd: path.join(PACKAGES_DIR, id),
      env,
      stdio: "inherit",
    });
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-pack-"));
  const unpacked = (id) => path.join(work, "packed", id);
  for (const id of LOCKSTEP) {
    execSync(`yarn pack --filename ${path.join(work, `${id}.tgz`)}`, {
      cwd: path.join(PACKAGES_DIR, id),
      env,
      stdio: "inherit",
    });
    fs.mkdirSync(unpacked(id), { recursive: true });
    tar(`-xzf ${id}.tgz --strip-components=1 -C ${unpacked(id)}`, work);
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

    // Bundles copy the packed tarballs, so no bundled copy nests another.
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
    tar(
      `-czf ${urlTarball(id, version)} -C ${path.dirname(urlStaging)} package`,
      OUT_DIR,
    );

    const registryStaging = path.join(work, "registry", id);
    fs.cpSync(unpacked(id), registryStaging, { recursive: true });
    writeJson(
      path.join(registryStaging, "package.json"),
      registryManifest(packed, id, version, sha, siblings),
    );
    // npm pack writes the same bytes for the same files, unlike tar.
    const [{ filename }] = JSON.parse(
      execSync(
        `npm pack ${registryStaging} --pack-destination ${REGISTRY_DIR} --ignore-scripts --json`,
        { env, encoding: "utf-8" },
      ),
    );
    fs.renameSync(
      path.join(REGISTRY_DIR, filename),
      path.join(REGISTRY_DIR, registryTarball(id, version)),
    );
  }
  fs.rmSync(work, { recursive: true, force: true });

  const asset = (file) => ({
    file,
    sha512: sha512(path.join(OUT_DIR, file)),
  });
  writeJson(path.join(OUT_DIR, "artifact.json"), {
    version,
    sha,
    assets: LOCKSTEP.map((id) => ({ id, ...asset(urlTarball(id, version)) })),
    registry: LOCKSTEP.map((id) => ({
      id,
      name: registryName(id),
      ...asset(`registry/${registryTarball(id, version)}`),
    })),
  });
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
