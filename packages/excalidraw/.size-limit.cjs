// Bundle the way a consumer's production build would: ESM, dev-only
// branches removed, and fonts left as the separate files browsers fetch.
const asConsumerBundles = (config) => ({
  ...config,
  format: "esm",
  define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
  external: [...config.external, "*.woff2"],
});

// Limits sit just above the sizes measured on master at 63de718d
// (2,023,165 and 24,976 bytes brotli). Raise one only in the change that
// grows the bundle, and say why in that change.
module.exports = [
  {
    name: "Excalidraw component with its dependencies and lazy chunks",
    path: "dist/prod/index.js",
    import: "{ Excalidraw }",
    modifyEsbuildConfig: asConsumerBundles,
    limit: "2030 kB",
  },
  {
    name: "Editor CSS",
    path: "dist/prod/index.css",
    modifyEsbuildConfig: asConsumerBundles,
    limit: "25.5 kB",
  },
];
