const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");

const { planRelease, releaseTags } = require("./version");

const FIELD = "\x1f";
const RECORD = "\x1e";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

const records = (output) =>
  output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => record.split(FIELD));

const readTags = () =>
  records(
    git(
      "for-each-ref",
      "refs/tags",
      "--format=%(refname:strip=2)%1f%(objecttype)%1f%(objectname)%1f%(*objectname)%1f%(contents)%1e",
    ),
  ).map(([name, type, object, peeled, contents]) =>
    type === "tag"
      ? { name, type, sha: peeled, message: contents }
      : { name, type, sha: object, message: "" },
  );

const readCommits = (base, head) =>
  base
    ? records(
        git(
          "log",
          "--no-merges",
          "--format=%H%x1f%s%x1f%b%x1e",
          `${base}..${head}`,
        ),
      ).map(([sha, subject, body]) => ({ sha, subject, body }))
    : [];

const newestDrawTag = (head) =>
  git(
    "tag",
    "--merged",
    head,
    "--list",
    "v*-draw.*",
    "--sort=-v:refname",
  ).split("\n")[0] || null;

// A draft is invisible to a read-only token, which is fine: a draft and a
// missing release both mean the claim is still open.
const isPublished = (tag) => {
  const result = spawnSync(
    "gh",
    ["release", "view", tag, "--json", "isDraft", "--jq", ".isDraft"],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    return result.stdout.trim() === "false";
  }
  if (/release not found/.test(result.stderr ?? "")) {
    return false;
  }
  throw new Error(
    `Could not check the ${tag} release: ${
      (result.stderr ?? "").trim() || result.error
    }`,
  );
};

const main = (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      head: { type: "string", default: "HEAD" },
      version: { type: "string" },
      out: { type: "string", default: "." },
      "github-output": { type: "string" },
      offline: { type: "boolean", default: false },
    },
  });

  const head = git("rev-parse", "--verify", `${values.head}^{commit}`).trim();
  const tags = releaseTags(readTags());
  const complete = new Set(
    tags
      .filter((tag) => values.offline || isPublished(tag.tag))
      .map((tag) => tag.tag),
  );
  const since = tags.at(-1)?.tag ?? newestDrawTag(head);
  const plan = planRelease({
    head,
    tags,
    isComplete: (tag) => complete.has(tag),
    override: values.version || undefined,
    commits: readCommits(since, head),
    since,
  });

  const outputs = {
    action: plan.action,
    version: plan.version ?? "",
    tag: plan.tag ?? "",
    sha: plan.sha ?? "",
  };
  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${value}`,
  );
  console.info(lines.join("\n"));
  if (values["github-output"]) {
    fs.appendFileSync(values["github-output"], `${lines.join("\n")}\n`);
  }

  if (plan.action === "nothing") {
    console.info(
      `\nNothing to release: no commit since ${plan.prev} changes the packages.`,
    );
    return;
  }
  fs.mkdirSync(values.out, { recursive: true });
  fs.writeFileSync(path.join(values.out, "notes.md"), `${plan.notes}\n`);
  console.info(`\n${plan.notes}`);
};

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
