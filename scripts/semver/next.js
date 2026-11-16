const { execFileSync } = require("child_process");
const fs = require("fs");

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const LEVELS = ["none", "patch", "minor", "major"];

const parseVersion = (version) => version.split(".").map(Number);

const compareVersions = (a, b) => {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

const bumpVersion = (version, level) => {
  const [major, minor, patch] = parseVersion(version);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Cannot bump ${version} by ${level}`);
  }
};

const CONVENTIONAL_TITLE = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?: \S/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const MERGE_SUBJECT = /^Merge pull request #\d+ /;

// A squash merge's subject is the PR title. A merge commit's title is the
// first line of its body.
const titleOf = ({ subject, body = "" }) =>
  MERGE_SUBJECT.test(subject) ? body.trim().split("\n")[0] ?? "" : subject;

const releaseLevel = (commit) => {
  const match = CONVENTIONAL_TITLE.exec(titleOf(commit));
  if (!match) {
    return "none";
  }
  if (match.groups.breaking || BREAKING_FOOTER.test(commit.body ?? "")) {
    return "major";
  }
  switch (match.groups.type.toLowerCase()) {
    case "feat":
      return "minor";
    case "fix":
    case "perf":
    case "revert":
      return "patch";
    default:
      return "none";
  }
};

const highestLevel = (commits) =>
  commits
    .map(releaseLevel)
    .reduce(
      (highest, level) =>
        LEVELS.indexOf(level) > LEVELS.indexOf(highest) ? level : highest,
      "none",
    );

// lastTag: the highest vX.Y.Z tag. containingTag: a release tag that already
// contains the commit, if any. treeVersion: the packages' version in the
// commit's tree. commits: what the commit adds since lastTag.
//
// Only a bump PR changes the version on master, so a release is always the
// version master's manifests already hold. Changes without a bump yield the
// version that bump PR should set.
const plan = ({ lastTag, containingTag, treeVersion, commits }) => {
  const lastVersion = lastTag.slice(1);
  if (containingTag) {
    return {
      release: false,
      reason: `${containingTag} already contains this commit`,
    };
  }
  if (compareVersions(treeVersion, lastVersion) > 0) {
    return {
      release: true,
      version: treeVersion,
      reason: `master's manifests are at ${treeVersion}, which no tag has released`,
    };
  }
  const level = highestLevel(commits);
  if (level === "none") {
    return {
      release: false,
      reason: `no feat, fix, perf, revert or breaking change since ${lastTag}`,
    };
  }
  return {
    release: false,
    pending: bumpVersion(lastVersion, level),
    reason: `a ${level} change since ${lastTag}, and the manifests are still at ${treeVersion}`,
  };
};

const headline = (result) => {
  if (result.release) {
    return `Release ${result.version} from master's manifests: ${result.reason}.`;
  }
  if (result.pending) {
    return `Release pending: open a bump PR to ${result.pending} (node scripts/semver/bump.js ${result.pending}). ${result.reason}.`;
  }
  return `No release: ${result.reason}.`;
};

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 26 });

const releaseTags = (lines) =>
  lines
    .split("\n")
    .map((line) => line.trim())
    .filter((tag) => RELEASE_TAG.test(tag))
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)));

// Reads what plan needs from the repository at cwd. A tag's commit may be the
// bump commit a release added on top of master. lastTag..sha still excludes
// the master commit under it, which is an ancestor of the tag.
const readRepository = ({ sha, cwd }) => {
  const tags = releaseTags(git(["tag", "--list", "v*"], cwd));
  const lastTag = tags[tags.length - 1];
  if (!lastTag) {
    throw new Error("No vX.Y.Z tag exists, so there is no version to bump.");
  }
  const containing = releaseTags(
    git(["tag", "--list", "v*", "--contains", sha], cwd),
  );
  const log = git(
    [
      "log",
      "--first-parent",
      "--format=%H%x1f%s%x1f%b%x1e",
      `${lastTag}..${sha}`,
    ],
    cwd,
  );
  const commits = log
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body] = record.split("\x1f");
      return { hash, subject, body };
    });
  const treeVersion = JSON.parse(
    git(["show", `${sha}:packages/excalidraw/package.json`], cwd),
  ).version;
  return { lastTag, containingTag: containing[0], treeVersion, commits };
};

const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

if (require.main === module) {
  const sha = argument("sha");
  const title = argument("title");
  if (!sha) {
    console.error(
      'Usage: node scripts/semver/next.js --sha=<master commit> [--title="<PR title to count as merged>"]',
    );
    process.exit(1);
  }
  try {
    const repository = readRepository({ sha, cwd: process.cwd() });
    if (title !== undefined) {
      repository.commits.push({ hash: "(this PR)", subject: title, body: "" });
    }
    const result = plan(repository);
    const lines = [
      headline(result),
      "",
      `Last tag ${repository.lastTag}; packages at ${repository.treeVersion} in ${sha}.`,
      "",
      ...repository.commits.map(
        (commit) =>
          `- ${releaseLevel(commit).padEnd(5)} ${titleOf(commit)} (${
            /^[0-9a-f]{40}$/.test(commit.hash)
              ? commit.hash.slice(0, 8)
              : commit.hash
          })`,
      ),
    ];
    console.info(lines.join("\n"));
    if (result.pending) {
      console.info(`::notice title=Release pending::${lines[0]}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### ${lines[0]}\n\n${lines.slice(2).join("\n")}\n`,
      );
    }
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        [
          `release=${result.release}`,
          `version=${result.version ?? ""}`,
          `pending=${result.pending ?? ""}`,
          "",
        ].join("\n"),
      );
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  bumpVersion,
  headline,
  compareVersions,
  plan,
  readRepository,
  releaseLevel,
};
