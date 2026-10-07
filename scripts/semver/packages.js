const LOCKSTEP = [
  "common",
  "fractional-indexing",
  "math",
  "element",
  "excalidraw",
];

// excalidraw goes last, so a consumer never resolves it while a sibling it
// depends on is still missing from the registry.
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

const siblingClosure = (id, manifestsById) => {
  throw new Error("not implemented");
};

const urlManifest = (packed, id, version, siblings) => {
  throw new Error("not implemented");
};

const registryManifest = (packed, id, version, sha, siblings) => {
  throw new Error("not implemented");
};

const consumerNpmrc = (registryUrl) => {
  throw new Error("not implemented");
};

module.exports = {
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
