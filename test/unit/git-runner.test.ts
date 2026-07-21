import test from "node:test";
import assert from "node:assert/strict";
import { GitRunner } from "../../src/git/git-runner.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
  writeRepoFile,
} from "../helpers/git-repo.ts";

test("GitRunner reads repository state and staged files", async () => {
  const repoRoot = await createGitRepo();
  try {
    await writeRepoFile(repoRoot, "README.md", "story\n");
    await git(repoRoot, ["add", "README.md"]);

    const runner = new GitRunner(repoRoot);

    assert.ok((await runner.branch()).length > 0);
    assert.deepEqual(await runner.stagedFiles(), ["README.md"]);
    assert.match(await runner.writeTree(), /^[0-9a-f]{40}$/);
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("GitRunner exposes command context when Git fails", async () => {
  const repoRoot = await createGitRepo();
  try {
    const runner = new GitRunner(repoRoot);
    await assert.rejects(
      () => runner.run(["rev-parse", "--verify", "missing-ref"]),
      (error: Error) =>
        error.message.includes("git rev-parse --verify missing-ref") &&
        error.message.includes("fatal"),
    );
  } finally {
    await removeGitRepo(repoRoot);
  }
});
