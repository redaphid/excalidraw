const LOCKSTEP = [
  "common",
  "fractional-indexing",
  "math",
  "element",
  "excalidraw",
];

const PUBLISH_ORDER = [
  "fractional-indexing",
  "math",
  "common",
  "element",
  "excalidraw",
];

const GITHUB_REGISTRY = "https://npm.pkg.github.com";
const REPOSITORY = "https://github.com/redaphid/excalidraw";

const sourceName = (id) => `@excalidraw/${id}`;

// GitHub Packages only accepts the owner's scope.
const registryName = (id) =>
  id === "excalidraw" ? "@redaphid/excalidraw" : `@redaphid/excalidraw-${id}`;

const isLockstep = (name) => LOCKSTEP.some((id) => sourceName(id) === name);

const lockstepDependencies = (manifest) =>
  LOCKSTEP.filter((id) => manifest.dependencies?.[sourceName(id)]);

const siblingClosure = (id, manifestsById) => {
  const reached = new Set([id]);
  const visit = (current) => {
    for (const dependency of lockstepDependencies(manifestsById[current])) {
      if (!reached.has(dependency)) {
        reached.add(dependency);
        visit(dependency);
      }
    }
  };
  visit(id);
  return LOCKSTEP.filter((other) => other !== id && reached.has(other));
};

const atVersion = (manifest, version) => {
  if (!manifest.dependencies) {
    return { ...manifest, version };
  }
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies).map(([name, specifier]) => [
      name,
      isLockstep(name) ? version : specifier,
    ]),
  );
  return { ...manifest, version, dependencies };
};

const urlManifest = (packed, id, version, siblings) => {
  const manifest = atVersion(packed[id], version);
  if (siblings.length === 0) {
    return manifest;
  }
  const dependencies = { ...manifest.dependencies };
  for (const sibling of siblings) {
    for (const [name, specifier] of Object.entries(
      packed[sibling].dependencies ?? {},
    )) {
      if (!isLockstep(name)) {
        dependencies[name] = specifier;
      }
    }
    dependencies[sourceName(sibling)] = version;
  }
  return {
    ...manifest,
    dependencies,
    bundleDependencies: siblings.map(sourceName),
  };
};

// Upstream's excalidraw source imports element's source by relative path, so
// its bundle carries element's imports, such as @excalidraw/fractional-indexing,
// that its manifest never declares. Aliasing the whole sibling closure covers
// any sibling that bundled code reaches.
const registryManifest = (packed, id, version, sha, siblings) => {
  const { dependencies = {}, ...manifest } = packed[id];
  delete manifest.bundleDependencies;
  return {
    ...manifest,
    name: registryName(id),
    version,
    gitHead: sha,
    dependencies: Object.fromEntries([
      ...Object.entries(dependencies).filter(([name]) => !isLockstep(name)),
      ...siblings.map((sibling) => [
        sourceName(sibling),
        `npm:${registryName(sibling)}@${version}`,
      ]),
    ]),
    publishConfig: { registry: GITHUB_REGISTRY },
    repository: {
      type: "git",
      url: `git+${REPOSITORY}.git`,
      directory: `packages/${id}`,
    },
  };
};

const consumerNpmrc = (registryUrl) => {
  const { host, pathname } = new URL(registryUrl);
  return `@redaphid:registry=${registryUrl}\n//${host}${pathname}:_authToken=\${NODE_AUTH_TOKEN}\n`;
};

module.exports = {
  atVersion,
  consumerNpmrc,
  GITHUB_REGISTRY,
  LOCKSTEP,
  PUBLISH_ORDER,
  REPOSITORY,
  registryManifest,
  registryName,
  siblingClosure,
  sourceName,
  urlManifest,
};
