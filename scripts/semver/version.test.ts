import {
  classify,
  compareVersions,
  parseVersion,
  planRelease,
  releaseTags,
  tagMessage,
} from "./version";

const commit = (subject: string, body = "", sha = "a".repeat(40)) => ({
  sha,
  subject,
  body,
});

const releaseTag = (version: string, sha = "1".repeat(40)) => ({
  name: `v${version}`,
  type: "tag",
  sha,
  message: tagMessage(`Notes for ${version}.`),
});

const HEAD = "f".repeat(40);
const complete = () => true;

describe("classify", () => {
  it.each([
    ["feat(editor): add lasso (#12)", "minor"],
    ["fix(editor): keep arrows bound (#13)", "patch"],
    ["perf(editor): cache bounds (#14)", "patch"],
    ["docs(repo): explain auth (#15)", "patch"],
    ["feat(editor)!: drop the legacy API (#16)", "major"],
    ["fix!: change the export format (#17)", "major"],
    ["Merge remote-tracking branch 'upstream/master'", "patch"],
    ["Tweak the toolbar", "patch"],
  ])("bumps %j as %s", (subject, bump) => {
    // Defect: a feat that patches, a fix that minors, or a lost "!".
    expect(classify(commit(subject))?.bump).toBe(bump);
  });

  it.each([
    "BREAKING CHANGE: the export format changed",
    "BREAKING-CHANGE: the export format changed",
    "* fix(io): rename the field\n\n  BREAKING CHANGE: old files no longer load",
  ])("treats the footer %j as breaking", (body) => {
    // Defect: a squash body's breaking footer is ignored.
    const change = classify(commit("fix(io): rename the field (#20)", body));
    expect(change).toMatchObject({ bump: "major", breaking: true });
  });

  it("does not treat prose about breaking changes as breaking", () => {
    // Defect: any mention of "breaking change" bumps the major version.
    const change = classify(
      commit(
        "fix(io): read old files (#21)",
        "This is not a breaking change. Nothing about breaking-change: here.",
      ),
    );
    expect(change).toMatchObject({ bump: "patch", breaking: false });
  });

  it("ignores the draw version bookkeeping commit", () => {
    // Defect: every draw.N version commit forces a release.
    expect(classify(commit("chore: version the packages 0.19.0-draw.22"))).toBe(
      null,
    );
    expect(
      classify(commit("chore(repo): version the packages 0.19.0-draw.23")),
    ).toBe(null);
  });
});

describe("versions", () => {
  it("compares numerically", () => {
    // Defect: string comparison puts 1.10.0 below 1.9.0.
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it.each(["1.0", "01.0.0", "1.0.0-rc.1", "v1.0.0", "1.0.0 "])(
    "rejects %j",
    (text) => {
      // Defect: a malformed override becomes a tag.
      expect(() => parseVersion(text)).toThrow(/not a version/);
    },
  );
});

describe("releaseTags", () => {
  it("keeps only annotated release tags, oldest first", () => {
    // Defect: upstream or draw tags become the base of the next version.
    const tags = releaseTags([
      releaseTag("1.10.0"),
      { name: "v0.18.1", type: "commit", sha: "2".repeat(40), message: "" },
      {
        name: "v0.19.0-draw.21",
        type: "tag",
        sha: "3".repeat(40),
        message: "x",
      },
      releaseTag("1.9.0"),
    ]);
    expect(tags.map((tag) => tag.tag)).toEqual(["v1.9.0", "v1.10.0"]);
    expect(tags[0].notes).toBe("Notes for 1.9.0.");
  });

  it.each([
    ["a lightweight tag", { type: "commit", message: "" }],
    ["an annotated tag without the trailer", { type: "tag", message: "1.4.0" }],
  ])("refuses %s at v1.4.0", (_, shape) => {
    // Defect: a hand-made tag silently becomes the last release.
    expect(() =>
      releaseTags([{ name: "v1.4.0", sha: "4".repeat(40), ...shape }]),
    ).toThrow(/v1\.4\.0/);
  });
});

describe("planRelease", () => {
  const plan = (input: Partial<Parameters<typeof planRelease>[0]>) =>
    planRelease({
      head: HEAD,
      tags: [],
      isComplete: complete,
      commits: [],
      since: "v0.19.0-draw.21",
      ...input,
    });

  it("bootstraps 1.0.0 with the changes since the draw tag", () => {
    // Defect: the first release takes its version from draw.N or a bump.
    const result = plan({
      commits: [commit("feat(editor): add lasso (#12)", "", "b".repeat(40))],
    });
    expect(result).toMatchObject({
      action: "cut",
      version: "1.0.0",
      tag: "v1.0.0",
      sha: HEAD,
      why: "bootstrap",
    });
    expect(result.notes).toBe(
      "First semver release. Changes since v0.19.0-draw.21.\n\n## Features\n\n- feat(editor): add lasso (#12) (bbbbbbb)",
    );
  });

  it("bumps by the highest change since the last release", () => {
    // Defect: the bump follows the newest commit instead of the largest.
    const result = plan({
      tags: releaseTags([releaseTag("1.0.0")]),
      since: "v1.0.0",
      commits: [
        commit("fix(editor): one (#30)"),
        commit("feat(editor): two (#29)"),
        commit("perf(editor): three (#28)"),
      ],
    });
    expect(result).toMatchObject({ action: "cut", version: "1.1.0" });
  });

  it.each([
    ["1.4.7", "feat(x): y", "1.5.0"],
    ["1.4.7", "feat(x)!: y", "2.0.0"],
    ["1.4.7", "fix(x): y", "1.4.8"],
  ])("from %s, %j releases %s", (prev, subject, next) => {
    // Defect: a minor bump keeps the patch, or a major keeps the minor.
    const result = plan({
      tags: releaseTags([releaseTag(prev)]),
      commits: [commit(subject)],
    });
    expect(result.version).toBe(next);
  });

  it("releases nothing when only bookkeeping commits landed", () => {
    // Defect: a draw version commit cuts an empty semver release.
    const result = plan({
      tags: releaseTags([releaseTag("1.0.0")]),
      commits: [commit("chore: version the packages 0.19.0-draw.22")],
    });
    expect(result).toEqual({ action: "nothing", prev: "v1.0.0" });
  });

  it("resumes an open claim at its own commit even when head moved", () => {
    // Defect: a crashed release is abandoned, or rebuilt from a newer commit.
    const claimSha = "c".repeat(40);
    const result = plan({
      tags: releaseTags([releaseTag("1.0.0"), releaseTag("1.1.0", claimSha)]),
      isComplete: (tag: string) => tag === "v1.0.0",
      commits: [commit("feat(editor)!: newer work (#40)")],
    });
    expect(result).toEqual({
      action: "resume",
      version: "1.1.0",
      tag: "v1.1.0",
      sha: claimSha,
      notes: "Notes for 1.1.0.",
    });
  });

  it("takes an override and says so in the notes", () => {
    const result = plan({
      tags: releaseTags([releaseTag("1.0.0")]),
      since: "v1.0.0",
      override: "3.0.0",
    });
    expect(result).toMatchObject({ action: "cut", version: "3.0.0" });
    expect(result.notes).toBe("Version set by hand. Changes since v1.0.0.");
  });

  it("refuses an override below the last release", () => {
    // Defect: a typo publishes a version that sorts below the latest.
    expect(() =>
      plan({ tags: releaseTags([releaseTag("1.2.0")]), override: "1.1.9" }),
    ).toThrow(/above v1\.2\.0/);
  });

  it("refuses an override that names an existing release", () => {
    // Defect: an override re-releases a version that already exists.
    expect(() =>
      plan({
        tags: releaseTags([releaseTag("1.0.0"), releaseTag("1.2.0")]),
        override: "1.0.0",
      }),
    ).toThrow(/above v1\.2\.0/);
  });

  it("refuses an override below 1.0.0 before the first release", () => {
    // Defect: the first semver release lands in upstream's 0.x range.
    expect(() => plan({ override: "0.5.0" })).toThrow(/at least 1\.0\.0/);
  });

  it("refuses a different override while a claim is open", () => {
    // Defect: an open claim is left half published while another version ships.
    expect(() =>
      plan({
        tags: releaseTags([releaseTag("1.1.0")]),
        isComplete: () => false,
        override: "1.2.0",
      }),
    ).toThrow(/v1\.1\.0 is claimed/);
  });
});
