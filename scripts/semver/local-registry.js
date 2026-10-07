const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const option = (name) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const dir = option("dir");
const token = option("token");

if (!dir || !token) {
  console.error(
    "Usage: node scripts/semver/local-registry.js --dir=release/registry --token=<token>",
  );
  process.exit(1);
}

const field = (header, start, end) =>
  header.toString("utf-8", start, end).replace(/\0.*$/s, "");

const manifestOf = (tarball) => {
  const archive = zlib.gunzipSync(tarball);
  for (let offset = 0; field(archive, offset, offset + 100); ) {
    const name = field(archive, offset, offset + 100);
    const prefix = field(archive, offset + 345, offset + 500);
    const size = parseInt(field(archive, offset + 124, offset + 136), 8);
    const body = offset + 512;
    if ((prefix ? `${prefix}/${name}` : name) === "package/package.json") {
      return JSON.parse(archive.toString("utf-8", body, body + size));
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  throw new Error("the tarball has no package/package.json");
};

const published = new Map();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".tgz"))) {
  const bytes = fs.readFileSync(path.join(dir, file));
  const manifest = manifestOf(bytes);
  if (!manifest.name.startsWith("@redaphid/")) {
    continue;
  }
  published.set(manifest.name, [
    ...(published.get(manifest.name) ?? []),
    {
      file,
      bytes,
      manifest,
      integrity: `sha512-${crypto
        .createHash("sha512")
        .update(bytes)
        .digest("base64")}`,
      shasum: crypto.createHash("sha1").update(bytes).digest("hex"),
    },
  ]);
}

const packument = (base, name, entries) => ({
  name,
  "dist-tags": { latest: entries[entries.length - 1].manifest.version },
  versions: Object.fromEntries(
    entries.map(({ file, manifest, integrity, shasum }) => [
      manifest.version,
      {
        ...manifest,
        _id: `${name}@${manifest.version}`,
        dist: { tarball: `${base}${name}/-/${file}`, integrity, shasum },
      },
    ]),
  ),
});

const server = http.createServer((request, response) => {
  const send = (status, body, type = "application/json") => {
    response.writeHead(status, { "content-type": type });
    response.end(type === "application/json" ? JSON.stringify(body) : body);
  };
  if (request.headers.authorization !== `Bearer ${token}`) {
    return send(401, { error: "unauthorized" });
  }
  const base = `http://${request.headers.host}/`;
  // npm and pnpm ask for @scope/name as @scope%2fname.
  const [name, file] = decodeURIComponent(
    new URL(request.url, base).pathname.slice(1),
  ).split("/-/");
  const entries = published.get(name);
  if (!entries) {
    return send(404, { error: `${name} is not in this registry` });
  }
  if (file === undefined) {
    return send(200, packument(base, name, entries));
  }
  const entry = entries.find((candidate) => candidate.file === file);
  return entry
    ? send(200, entry.bytes, "application/octet-stream")
    : send(404, { error: `${name} has no ${file}` });
});

server.listen(0, "127.0.0.1", () => {
  console.info(`READY http://127.0.0.1:${server.address().port}/`);
});
