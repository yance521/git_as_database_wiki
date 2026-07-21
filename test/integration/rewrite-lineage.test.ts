import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { installHooks } from "../../src/hooks/install.ts";
import { attachSession } from "../../src/core/session-store.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
  writeRepoFile,
} from "../helpers/git-repo.ts";

test("amend preserves checkpoint evidence and records rewrite lineage", async () => {
  const repoRoot = await createGitRepo();
  try {
    await installHooks(repoRoot, path.resolve(process.cwd(), "bin/story.js"));
    await writeRepoFile(
      repoRoot,
      "session.jsonl",
      '{"type":"user","text":"Track amend lineage"}\n',
    );
    await attachSession(repoRoot, "session.jsonl");
    await writeRepoFile(repoRoot, "feature.txt", "before\n");
    await git(repoRoot, ["add", "feature.txt"]);
    await git(repoRoot, ["commit", "-qm", "feat: before"]);
    const oldSha = await git(repoRoot, ["rev-parse", "HEAD"]);

    await writeRepoFile(repoRoot, "feature.txt", "after\n");
    await git(repoRoot, ["add", "feature.txt"]);
    await git(repoRoot, ["commit", "--amend", "-qm", "feat: after"]);
    const newSha = await git(repoRoot, ["rev-parse", "HEAD"]);
    assert.notEqual(oldSha, newSha);

    const lineageFiles = (await git(repoRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      "refs/heads/story/checkpoints/v1",
    ]))
      .split("\n")
      .filter((entry) => entry.startsWith("lineage/"));
    assert.equal(lineageFiles.length, 1);
    assert.match(
      await git(repoRoot, [
        "show",
        `refs/heads/story/checkpoints/v1:${lineageFiles[0]}`,
      ]),
      new RegExp(`"${oldSha}"`),
    );
    assert.match(
      await git(repoRoot, [
        "show",
        `refs/heads/story/checkpoints/v1:${lineageFiles[0]}`,
      ]),
      new RegExp(`"${newSha}"`),
    );
  } finally {
    await removeGitRepo(repoRoot);
  }
});
