import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { plan, readRepository, releaseLevel } = require("./next");

type Commit = { subject: string; body?: string };

const titles = (...subjects: string[]): Commit[] =>
  subjects.map((subject) => ({ subject, body: "" }));

const next = (commits: Commit[], treeVersion = "1.10.0") =>
  plan({ lastTag: "v1.10.0", treeVersion, commits });

describe("releaseLevel", () => {
  it.each([
    ["feat(editor): auto-arrange with ELK (#59)", "minor"],
    ["fix(element): a tap draws nothing (#167)", "patch"],
    ["perf(element): stop each rebuild by time (#160)", "patch"],
    ['revert(editor): revert "feat(editor): x" (#170)', "patch"],
    ["feat(editor)!: drop the legacy API (#171)", "major"],
    ["fix!: rename the export (#172)", "major"],
    ["chore(repo): version the packages 1.10.0 (#166)", "none"],
    ["docs(repo): show a dive through portals (#158)", "none"],
    ["ci(ci): cache playwright (#173)", "none"],
    ["refactor(element): split a module (#174)", "none"],
    ["test(editor): cover zoom (#175)", "none"],
    ["Update README.md", "none"],
    ["feature(editor): not a conventional type", "none"],
    ["featx(editor): not feat either", "none"],
  ])("%s -> %s", (subject, level) => {
    expect(releaseLevel({ subject, body: "" })).toBe(level);
  });

  it("reads a BREAKING CHANGE footer as major", () => {
    expect(
      releaseLevel({
        subject: "feat(editor): new scene format (#176)",
        body: "Long text.\n\nBREAKING CHANGE: old scenes no longer load.\n",
      }),
    ).toBe("major");
  });

  it("reads a merge commit's title from its body", () => {
    expect(
      releaseLevel({
        subject: "Merge pull request #177 from redaphid/branch",
        body: "feat(editor): merged without squashing\n",
      }),
    ).toBe("minor");
  });
});

describe("plan", () => {
  it("takes the largest change since the last tag", () => {
    expect(
      next(
        titles(
          "feat(editor): auto-arrange with ELK (#59)",
          "perf(element): faster rebuilds (#160)",
          "fix(element): a tap draws nothing (#167)",
        ),
      ),
    ).toMatchObject({ release: true, version: "1.11.0", bump: true });
  });

  it("bumps the patch for fixes and perf alone", () => {
    expect(
      next(titles("fix(element): x (#1)", "perf(editor): y (#2)")),
    ).toMatchObject({ release: true, version: "1.10.1" });
  });

  it("bumps the major and resets minor and patch for a breaking change", () => {
    expect(
      next(titles("fix(element): x (#1)", "feat(editor)!: y (#2)")),
    ).toMatchObject({ release: true, version: "2.0.0" });
  });

  it("does not release chores and docs alone", () => {
    expect(
      next(titles("chore(repo): tidy (#1)", "docs(repo): explain (#2)")),
    ).toMatchObject({ release: false });
  });

  it("does not release nothing", () => {
    expect(next([])).toMatchObject({ release: false });
  });

  it("releases a hand bump at its own version, without another bump", () => {
    expect(
      next(
        titles(
          "feat(editor): x (#1)",
          "chore(repo): version the packages 1.10.1 (#2)",
        ),
        "1.10.1",
      ),
    ).toMatchObject({ release: true, version: "1.10.1", bump: false });
  });

  it("bumps past the last tag when master's packages lag behind it", () => {
    expect(next(titles("fix(element): x (#1)"), "1.9.0")).toMatchObject({
      release: true,
      version: "1.10.1",
      bump: true,
    });
  });

  it("does not release a commit a tag already contains", () => {
    expect(
      plan({
        lastTag: "v1.10.1",
        containingTag: "v1.10.1",
        treeVersion: "1.10.1",
        commits: [],
      }),
    ).toMatchObject({ release: false });
  });
});

describe("readRepository", { timeout: 30_000 }, () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const commit = (subject: string, version = "1.0.0") => {
    fs.mkdirSync(path.join(dir, "packages/excalidraw"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "packages/excalidraw/package.json"),
      JSON.stringify({ version }),
    );
    fs.writeFileSync(path.join(dir, "change.txt"), subject);
    git("add", "-A");
    git("commit", "-q", "-m", subject);
    return git("rev-parse", "HEAD");
  };
  const planAt = (sha: string) => plan(readRepository({ sha, cwd: dir }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "semver-next-"));
    git("init", "-q", "-b", "master");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("counts from the master commit under a bot bump commit's tag", () => {
    const released = commit("fix(element): released (#1)");
    git("checkout", "-q", "--detach");
    commit("chore(repo): version the packages 1.0.1", "1.0.1");
    git("tag", "v1.0.1");
    git("checkout", "-q", "master");
    expect(planAt(released)).toMatchObject({ release: false });

    const feature = commit("feat(editor): after the release (#2)");
    expect(planAt(feature)).toMatchObject({
      release: true,
      version: "1.1.0",
      bump: true,
    });
    expect(readRepository({ sha: feature, cwd: dir }).commits).toHaveLength(1);
  });

  it("skips a commit that a hand tag already points at", () => {
    commit("chore(repo): start", "1.0.0");
    git("tag", "v1.0.0");
    commit("fix(element): x (#1)");
    const bumped = commit("chore(repo): version the packages 1.0.1", "1.0.1");
    expect(planAt(bumped)).toMatchObject({
      release: true,
      version: "1.0.1",
      bump: false,
    });
    git("tag", "v1.0.1");
    expect(planAt(bumped)).toMatchObject({ release: false });
  });

  it("does not release a commit under a tag other than the highest", () => {
    commit("chore(repo): start", "1.0.0");
    git("tag", "v1.1.0");
    const fix = commit("fix(element): x (#1)");
    git("tag", "v1.0.1");
    expect(planAt(fix)).toMatchObject({ release: false });
  });

  it("reads the highest tag by semver, not by name", () => {
    commit("chore(repo): start", "1.9.0");
    git("tag", "v1.9.0");
    git("tag", "v1.10.0");
    git("tag", "v1.10.0-rc.1");
    const fix = commit("fix(element): x (#1)", "1.10.0");
    expect(planAt(fix)).toMatchObject({ version: "1.10.1" });
  });
});
