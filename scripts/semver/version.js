const TRAILER = "Release-Of: redaphid/excalidraw";
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BOOKKEEPING = /^chore(\([^)]*\))?: version the packages \S+$/;
const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:/;
const BREAKING_FOOTER = /^\s*(\*\s+)?BREAKING[ -]CHANGE:/m;

const BUMP_RANK = { patch: 0, minor: 1, major: 2 };

const SECTIONS = [
  ["major", "Breaking changes"],
  ["minor", "Features"],
  ["patch", "Fixes and other changes"],
];

const parseVersion = (text) => {
  const match = VERSION.exec(text);
  if (!match) {
    throw new Error(`${JSON.stringify(text)} is not a version like 1.2.3.`);
  }
  return match.slice(1).map(Number);
};

const compareVersions = (a, b) => {
  const [left, right] = [parseVersion(a), parseVersion(b)];
  const index = left.findIndex((part, i) => part !== right[i]);
  return index === -1 ? 0 : Math.sign(left[index] - right[index]);
};

const bumpVersion = (version, bump) => {
  const [major, minor, patch] = parseVersion(version);
  return {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  }[bump];
};

const classify = ({ sha, subject, body = "" }) => {
  if (BOOKKEEPING.test(subject)) {
    return null;
  }
  const match = CONVENTIONAL.exec(subject);
  const type = match ? match[1] : null;
  const breaking = Boolean(match?.[3]) || BREAKING_FOOTER.test(body);
  const bump = breaking ? "major" : type === "feat" ? "minor" : "patch";
  return { bump, type, breaking, subject, sha };
};

const tagMessage = (notes) => `${notes}\n\n${TRAILER}\n`;

const notesOf = (message) =>
  message
    .split("\n")
    .filter((line) => line !== TRAILER)
    .join("\n")
    .trim();

const foreignReason = (raw, version) => {
  if (VERSION.exec(version) === null) {
    return "its version has leading zeros";
  }
  if (raw.type !== "tag") {
    return "it is a lightweight tag";
  }
  if (!raw.message.split("\n").includes(TRAILER)) {
    return `its message lacks the "${TRAILER}" trailer`;
  }
  return null;
};

// v0.x tags are upstream's, so a release tag starts at 1.0.0. A tag at or
// above 1.0.0 that this workflow did not create would silently become the
// base of the next version, so it stops the release instead.
const releaseTags = (rawTags) =>
  rawTags
    .flatMap((raw) => {
      const match = RELEASE_TAG.exec(raw.name);
      if (!match || Number(match[1]) < 1) {
        return [];
      }
      const version = raw.name.slice(1);
      const reason = foreignReason(raw, version);
      if (reason) {
        throw new Error(
          `${raw.name} looks like a release tag, but ${reason}. Delete or rename it, then run again.`,
        );
      }
      return [
        { tag: raw.name, version, sha: raw.sha, notes: notesOf(raw.message) },
      ];
    })
    .sort((a, b) => compareVersions(a.version, b.version));

const headline = ({ why, since }) => {
  const from = since ? ` Changes since ${since}.` : "";
  return {
    bootstrap: `First semver release.${from}`,
    computed: `Version computed from the changes since ${since}.`,
    override: `Version set by hand.${from}`,
  }[why];
};

const renderNotes = (plan) => {
  const sections = SECTIONS.flatMap(([bump, title]) => {
    const lines = plan.changes
      .filter((change) => change.bump === bump)
      .map((change) => `- ${change.subject} (${change.sha.slice(0, 7)})`);
    return lines.length ? [`## ${title}\n\n${lines.join("\n")}`] : [];
  });
  return [headline(plan), ...sections].join("\n\n");
};

// tags: releaseTags() output, oldest first. commits: newest first, listed
// from `since` (the newest release tag, or the newest draw tag before 1.0.0).
const planRelease = ({ head, tags, isComplete, override, commits, since }) => {
  const open = tags.filter((tag) => !isComplete(tag.tag)).at(-1);
  if (open) {
    if (override !== undefined && override !== open.version) {
      throw new Error(
        `${open.tag} is claimed but not released. Finish it first: run the workflow with no version.`,
      );
    }
    return { action: "resume", ...open };
  }

  const prev = tags.at(-1) ?? null;
  const changes = commits.map(classify).filter(Boolean);
  if (override !== undefined) {
    const floor = prev?.version ?? "1.0.0";
    if (compareVersions(override, floor) < (prev ? 1 : 0)) {
      throw new Error(
        `Version ${override} must be ${
          prev ? `above ${prev.tag}` : "at least 1.0.0"
        }.`,
      );
    }
  } else if (prev && changes.length === 0) {
    return { action: "nothing", prev: prev.tag };
  }

  const highest = changes.reduce(
    (max, change) =>
      BUMP_RANK[change.bump] > BUMP_RANK[max] ? change.bump : max,
    "patch",
  );
  const version =
    override ?? (prev ? bumpVersion(prev.version, highest) : "1.0.0");
  const why =
    override !== undefined ? "override" : prev ? "computed" : "bootstrap";
  const plan = {
    action: "cut",
    version,
    tag: `v${version}`,
    sha: head,
    why,
    since,
    changes,
  };
  return { ...plan, notes: renderNotes(plan) };
};

module.exports = {
  classify,
  compareVersions,
  parseVersion,
  planRelease,
  releaseTags,
  renderNotes,
  tagMessage,
  TRAILER,
};
