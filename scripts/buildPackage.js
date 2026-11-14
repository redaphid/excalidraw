const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const { build } = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");

const { parseEnvVariables } = require("../packages/excalidraw/env.cjs");

const ENV_VARS = {
  development: {
    ...parseEnvVariables(`${__dirname}/../.env.development`),
    DEV: true,
  },
  production: {
    ...parseEnvVariables(`${__dirname}/../.env.production`),
    PROD: true,
  },
};

// Resolve a relative path from the source file's directory
const resolveRelativePath = (importPath, sourceFile) => {
  const sourceDir = path.dirname(sourceFile);
  const extensions = [".scss", ".css", ""];

  for (const ext of extensions) {
    const fullPath = path.resolve(sourceDir, importPath + ext);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    // Try with underscore prefix for partials
    const partialPath = path.join(
      path.dirname(fullPath),
      `_${path.basename(fullPath)}`,
    );
    if (fs.existsSync(partialPath)) {
      return partialPath;
    }
  }
  return null;
};

// Precompile function to convert relative paths to absolute paths
const precompile = (source, sourcePath) => {
  // Match @use and @forward statements with relative paths
  const importRegex = /(@use|@forward)\s+["'](\.[^"']+)["']/g;

  return source.replace(importRegex, (match, directive, importPath) => {
    const resolvedPath = resolveRelativePath(importPath, sourcePath);
    if (resolvedPath) {
      // Convert to file:// URL format for sass
      const fileUrl = pathToFileURL(resolvedPath).href;
      return `${directive} "${fileUrl}"`;
    }
    return match;
  });
};

// `new URL("./x.chunk", import.meta.url)` spawns a worker from a chunk
// entry. Bundlers that build from source resolve the extensionless path to
// x.chunk.ts; this build writes the entry as x.chunk.js beside index.js, so
// the URL has to name that file for the worker to load in a consumer.
const CHUNK_URL =
  /new URL\((["'])(\.\/[^"']+\.chunk)\1,\s*import\.meta\.url\)/g;

const chunkUrlPlugin = {
  name: "chunk-url",
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      // the rest load as esbuild would load them
      if (!source.match(CHUNK_URL)) {
        return undefined;
      }
      return {
        contents: source.replace(
          CHUNK_URL,
          (_, quote, chunk) =>
            `new URL(${quote}./${path.basename(
              chunk,
            )}.js${quote}, import.meta.url)`,
        ),
        loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
      };
    });
  },
};

// excludes all external dependencies and bundles only the source code
const getConfig = (outdir) => ({
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  packages: "external",
  plugins: [
    sassPlugin({
      precompile,
    }),
    chunkUrlPlugin,
  ],
  target: "es2020",
  assetNames: "[dir]/[name]",
  chunkNames: "[dir]/[name]-[hash]",
  alias: {
    "@excalidraw/utils": path.resolve(__dirname, "../packages/utils/src"),
  },
  external: [
    "@excalidraw/common",
    "@excalidraw/element",
    "@excalidraw/math",
    "@excalidraw/fractional-indexing",
  ],
  loader: {
    ".woff2": "file",
  },
});

function buildDev(config) {
  return build({
    ...config,
    sourcemap: true,
    define: {
      "import.meta.env": JSON.stringify(ENV_VARS.development),
    },
  });
}

function buildProd(config) {
  return build({
    ...config,
    minify: true,
    define: {
      "import.meta.env": JSON.stringify(ENV_VARS.production),
    },
  });
}

const createESMRawBuild = async () => {
  const chunksConfig = {
    entryPoints: ["index.tsx", "**/*.chunk.ts"],
    entryNames: "[name]",
  };

  // development unminified build with source maps
  await buildDev({
    ...getConfig("dist/dev"),
    ...chunksConfig,
  });

  // production minified buld without sourcemaps
  await buildProd({
    ...getConfig("dist/prod"),
    ...chunksConfig,
  });
};

(async () => {
  await createESMRawBuild();
})();
