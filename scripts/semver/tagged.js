const { spawnSync } = require("child_process");

// Prints the object a tag points at, or nothing when the tag does not exist.
// On a missing ref gh exits 1 and prints the 404 body on stdout, so stdout is
// trusted only on success, and any failure other than a 404 throws.
const taggedSha = ({ repository, tag, run }) => {
  const result = run("gh", [
    "api",
    `repos/${repository}/git/ref/tags/${tag}`,
    "--jq",
    ".object.sha",
  ]);
  if (result.status === 0) {
    const sha = result.stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`gh returned ${JSON.stringify(sha)} for ${tag}`);
    }
    return sha;
  }
  if (/\(HTTP 404\)/.test(result.stderr)) {
    return null;
  }
  throw new Error(
    `Looking up ${tag} failed (exit ${result.status}): ${
      result.stderr.trim() || result.stdout.trim() || result.error?.message
    }`,
  );
};

if (require.main === module) {
  const tag = process.argv
    .find((argument) => argument.startsWith("--tag="))
    ?.split("=")[1];
  const repository = process.env.GITHUB_REPOSITORY;
  if (!tag || !repository) {
    console.error(
      "Usage: GITHUB_REPOSITORY=<owner/repo> node scripts/semver/tagged.js --tag=v1.0.0",
    );
    process.exit(1);
  }
  try {
    const sha = taggedSha({
      repository,
      tag,
      run: (command, args) => spawnSync(command, args, { encoding: "utf8" }),
    });
    if (sha) {
      console.info(sha);
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { taggedSha };
