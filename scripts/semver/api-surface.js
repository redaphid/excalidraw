const fs = require("fs");
const path = require("path");

const { execFileSync, execSync } = require("child_process");

const ts = require("typescript");

const { compareVersions, plan, readRepository } = require("./next");
const { REPOSITORY, urlTarball } = require("./packages");

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "release");
const API_DIR = path.join(OUT_DIR, "api");

// The packages draw installs, whose declarations are the public API.
const CHECKED = ["common", "element", "excalidraw"];
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
// How far into nested object types a comparison names the property that broke.
const MAX_DEPTH = 3;

const major = (version) => Number(version.split(".")[0]);

// Our own declarations, as opposed to React's or the DOM's: only these are
// compared property by property.
const declaredByUs = (symbol) =>
  symbol?.declarations?.some((declaration) =>
    /[\\/]node_modules[\\/]@excalidraw[\\/]/.test(
      declaration.getSourceFile().fileName,
    ),
  ) ?? false;

// Ours when we declared the type or its members (Readonly<AppState>).
const isOurs = (type) =>
  declaredByUs(type.aliasSymbol ?? type.symbol) ||
  declaredByUs(type.getProperties()[0]);

const brief = (text) => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

const isOptional = (symbol) => (symbol.flags & ts.SymbolFlags.Optional) !== 0;

const callSignatures = (checker, type) =>
  checker.getSignaturesOfType(type, ts.SignatureKind.Call);

const isRecord = (checker, type) =>
  (type.flags & ts.TypeFlags.Object) !== 0 &&
  callSignatures(checker, type).length === 0 &&
  !checker.isArrayType(type) &&
  !checker.isTupleType(type) &&
  isOurs(type);

const TEXT =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.UseFullyQualifiedType;

// Lists what a consumer written against `before` can no longer do with
// `after`. "in" is a type the consumer passes (props, arguments): a property
// removed, made required, or narrowed breaks it. "out" is one it reads
// (constants, return values): a property removed, made optional, or widened
// breaks it. Both sides come from separate copies of the same declarations, so
// a class or enum is never assignable to its own copy; identical text counts
// as unchanged.
const comparer = (checker) => {
  const breaks = new Set();
  // Each side is its own copy, so names it qualifies differ only by path.
  const text = (type) =>
    checker
      .typeToString(type, undefined, TEXT)
      .replace(/import\("[^"]*"\)\./g, "");
  const compare = (before, after, where, direction, depth) => {
    if (
      depth < MAX_DEPTH &&
      isRecord(checker, before) &&
      isRecord(checker, after)
    ) {
      for (const property of checker.getPropertiesOfType(before)) {
        // Symbol-keyed members (Symbol.iterator) carry per-program ids.
        if (property.escapedName.startsWith("__@")) {
          continue;
        }
        const at = `${where}.${property.name}`;
        const next = checker.getPropertyOfType(after, property.name);
        if (!next) {
          breaks.add(`${at} was removed`);
          continue;
        }
        const [was, now] = [isOptional(property), isOptional(next)];
        if (direction === "in" && was && !now) {
          breaks.add(`${at} became required`);
          continue;
        }
        if (direction === "out" && !was && now) {
          breaks.add(`${at} became optional`);
          continue;
        }
        compare(
          checker.getTypeOfSymbol(property),
          checker.getTypeOfSymbol(next),
          at,
          direction,
          depth + 1,
        );
      }
      return;
    }
    // Generic shapes (T[K], conditionals) only compare once instantiated.
    if ((before.flags | after.flags) & ts.TypeFlags.Instantiable) {
      return;
    }
    const [from, to] = direction === "in" ? [before, after] : [after, before];
    if (checker.isTypeAssignableTo(from, to)) {
      return;
    }
    // A function a consumer may either call or implement: a change that still
    // fits one of those uses widens it rather than removing anything.
    if (
      callSignatures(checker, before).length > 0 &&
      checker.isTypeAssignableTo(to, from)
    ) {
      return;
    }
    if (text(before) !== text(after)) {
      breaks.add(
        `${where} ${direction === "in" ? "narrowed" : "changed"} from ${brief(
          text(before),
        )} to ${brief(text(after))}`,
      );
    }
  };

  const compareCallable = (before, after, where) => {
    const [was] = callSignatures(checker, before);
    const [now] = callSignatures(checker, after);
    if (!was || !now) {
      compare(before, after, where, "out", 0);
      return;
    }
    if (now.minArgumentCount > was.parameters.length) {
      breaks.add(
        `${where} requires ${now.minArgumentCount} arguments, was ${was.parameters.length}`,
      );
    }
    was.parameters.forEach((parameter, index) => {
      const at = `${where}(${parameter.name})`;
      const next = now.parameters[index];
      if (!next) {
        if (!now.parameters.at(-1)?.valueDeclaration?.dotDotDotToken) {
          breaks.add(`${at} was removed`);
        }
        return;
      }
      compare(
        checker.getTypeOfSymbol(parameter),
        checker.getTypeOfSymbol(next),
        at,
        "in",
        0,
      );
    });
  };

  return { breaks, compare, compareCallable };
};

const resolveAlias = (checker, symbol) =>
  symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;

// Compares the exports of each pair of entry declarations ({ id: [before,
// after] }) and returns what was removed or narrowed, sorted.
const surfaceBreaks = (entries) => {
  const program = ts.createProgram(Object.values(entries).flat(), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const { breaks, compare, compareCallable } = comparer(checker);
  const exportsOf = (file) => {
    const source = program.getSourceFile(file);
    if (!source) {
      throw new Error(`${file} is not in the program`);
    }
    return new Map(
      checker
        .getExportsOfModule(checker.getSymbolAtLocation(source))
        .map((symbol) => [symbol.name, resolveAlias(checker, symbol)]),
    );
  };
  for (const [id, [beforeFile, afterFile]] of Object.entries(entries)) {
    const before = exportsOf(beforeFile);
    const after = exportsOf(afterFile);
    for (const [name, was] of before) {
      const where = `@excalidraw/${id} ${name}`;
      const now = after.get(name);
      if (!now) {
        breaks.add(`${where} was removed`);
        continue;
      }
      if (was.flags & ts.SymbolFlags.Value) {
        if (!(now.flags & ts.SymbolFlags.Value)) {
          breaks.add(`${where} is no longer a value`);
        } else {
          compareCallable(
            checker.getTypeOfSymbol(was),
            checker.getTypeOfSymbol(now),
            where,
          );
        }
      }
      if (was.flags & ts.SymbolFlags.Type) {
        if (!(now.flags & ts.SymbolFlags.Type)) {
          breaks.add(`${where} is no longer a type`);
        } else if (!(was.flags & ts.SymbolFlags.Class)) {
          compare(
            checker.getDeclaredTypeOfSymbol(was),
            checker.getDeclaredTypeOfSymbol(now),
            where,
            "in",
            0,
          );
        }
      }
    }
  }
  return [...breaks].sort();
};

const releaseTags = () =>
  execFileSync("git", ["ls-remote", "--tags", `${REPOSITORY}.git`], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter((tag) => tag && RELEASE_TAG.test(tag))
    .map((tag) => tag.slice(1))
    .sort(compareVersions);

// Relative names only: Git for Windows' GNU tar reads "D:\..." as a host.
const extract = (tarball, into) => {
  fs.mkdirSync(into, { recursive: true });
  execSync(
    `tar -xzf ${path.basename(tarball)} --strip-components=1 -C ${path
      .relative(path.dirname(tarball), into)
      .split(path.sep)
      .join("/")}`,
    { cwd: path.dirname(tarball) },
  );
};

const download = async (url, file) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
};

// Lays out node_modules/@excalidraw/<id> for one version under API_DIR, from
// tarballs in `from` (a directory, or a release tag to download).
const install = async (label, version, from) => {
  const dir = path.join(API_DIR, label);
  fs.rmSync(dir, { recursive: true, force: true });
  const tarballs = path.join(dir, "tarballs");
  fs.mkdirSync(tarballs, { recursive: true });
  const entries = {};
  for (const id of CHECKED) {
    const name = urlTarball(id, version);
    const tarball = path.join(tarballs, name);
    if (from.startsWith("v")) {
      await download(
        `${REPOSITORY}/releases/download/${from}/${name}`,
        tarball,
      );
    } else {
      fs.copyFileSync(path.join(from, name), tarball);
    }
    const into = path.join(dir, "node_modules", "@excalidraw", id);
    extract(tarball, into);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(into, "package.json"), "utf-8"),
    );
    const index = path.join(into, manifest.types);
    entries[id] = index;
    // ExcalidrawProps, AppState and the element types live in the types entry.
    const types = path.join(path.dirname(index), "types.d.ts");
    if (fs.existsSync(types)) {
      entries[`${id}/types`] = types;
    }
  }
  return entries;
};

const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

// The version these changes will ship as: the packed version when a bump
// raised it past the base, otherwise the bump the commits since the base call
// for (with this PR's title counted as merged), as auto-release plans it.
const targetVersion = ({ version, base, sha, title }) => {
  if (compareVersions(version, base) > 0 || !sha) {
    return version;
  }
  const repository = readRepository({ sha, cwd: ROOT });
  if (title !== undefined) {
    repository.commits.push({ hash: "(this PR)", subject: title, body: "" });
  }
  const result = plan(repository);
  return result.version ?? result.pending ?? version;
};

const main = async () => {
  const version = argument("version");
  if (!version) {
    console.error(
      'Usage: node scripts/semver/api-surface.js --version=<packed version> [--base=<released version>] [--sha=<master commit> [--title="<PR title>"]]',
    );
    process.exit(1);
  }
  const base =
    argument("base") ??
    releaseTags()
      .filter((tag) => compareVersions(tag, version) <= 0)
      .at(-1);
  if (!base) {
    console.info(`No release at or below ${version} to compare with.`);
    return;
  }
  const before = await install(`base-${base}`, base, `v${base}`);
  const after = await install(
    `head-${version}`,
    version,
    argument("from") ?? OUT_DIR,
  );
  const breaks = surfaceBreaks(
    Object.fromEntries(
      Object.keys(before)
        .filter((entry) => after[entry])
        .map((entry) => [entry, [before[entry], after[entry]]]),
    ),
  );
  const target = targetVersion({
    version,
    base,
    sha: argument("sha"),
    title: argument("title"),
  });
  const summary = [
    breaks.length === 0
      ? `Public API: nothing removed or narrowed since v${base}.`
      : `Public API: ${breaks.length} removal(s) or narrowing(s) since v${base}; this ships as ${target}.`,
    ...breaks.map((line) => `- ${line}`),
  ];
  console.info(summary.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${summary.join("\n")}\n`,
    );
  }
  if (breaks.length > 0 && major(target) <= major(base)) {
    console.error(
      `::error::The public API lost or narrowed ${
        breaks.length
      } export(s) or prop(s) since v${base}, but ${target} is not a major bump. Mark the PR title breaking (feat!: ...) or bump to ${
        major(base) + 1
      }.0.0.`,
    );
    process.exit(1);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}

module.exports = { surfaceBreaks };
