import { taggedSha } from "./tagged";

const SHA = "30f723610f2ebaea64751e293cb973a17b16031f";

// What gh api printed for redaphid/excalidraw on 2026-11-16.
const NOT_FOUND = {
  status: 1,
  stdout:
    '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/git/refs#get-a-reference","status":"404"}',
  stderr: "gh: Not Found (HTTP 404)\n",
};

const lookup = (result: {
  status: number | null;
  stdout: string;
  stderr: string;
}) => {
  const calls: string[][] = [];
  const sha = () =>
    taggedSha({
      repository: "redaphid/excalidraw",
      tag: "v1.11.0",
      run: (command: string, args: string[]) => {
        calls.push([command, ...args]);
        return result;
      },
    });
  return { sha, calls };
};

describe("taggedSha", () => {
  it("returns the sha a tag points at", () => {
    const { sha, calls } = lookup({
      status: 0,
      stdout: `${SHA}\n`,
      stderr: "",
    });
    expect(sha()).toBe(SHA);
    expect(calls).toEqual([
      [
        "gh",
        "api",
        "repos/redaphid/excalidraw/git/ref/tags/v1.11.0",
        "--jq",
        ".object.sha",
      ],
    ]);
  });

  it("returns null for a tag that does not exist", () => {
    // Defect: release.yml read the 404 body on stdout as the tag's sha and
    // refused to release v1.11.0, which no tag pointed at.
    expect(lookup(NOT_FOUND).sha()).toBeNull();
  });

  it.each([
    [
      "an unreachable host",
      {
        status: 1,
        stdout: "",
        stderr:
          "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n",
      },
      /error connecting/,
    ],
    [
      "a server error",
      {
        status: 1,
        stdout: '{"message":"Server Error"}',
        stderr: "gh: Server Error (HTTP 502)\n",
      },
      /HTTP 502/,
    ],
    [
      "a rejected token",
      {
        status: 1,
        stdout: '{"message":"Bad credentials"}',
        stderr: "gh: Bad credentials (HTTP 401)\n",
      },
      /HTTP 401/,
    ],
    [
      "a success without a sha",
      { status: 0, stdout: "null\n", stderr: "" },
      /gh returned "null"/,
    ],
  ])("throws on %s", (_, result, reason) => {
    // Defect: `|| true` read any gh failure as "no tag", so a lookup that
    // never reached GitHub let a second build of a tagged version through.
    expect(lookup(result).sha).toThrow(reason);
  });
});
