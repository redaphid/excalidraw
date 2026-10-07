const asConsumerBundles = (config) => ({
  ...config,
  format: "esm",
  define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
  external: [...config.external, "*.woff2"],
});

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
