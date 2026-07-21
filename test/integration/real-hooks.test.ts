import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachSession } from "../../src/core/session-store.ts";
import { installHooks } from "../../src/hooks/install.ts";
import { createGitRepo, git, removeGitRepo, writeRepoFile } from "../helpers/git-repo.ts";

test("installed hooks capture a checkpoint through a normal git commit", async () => {
  const repoRoot = await createGitRepo();
  try {
    const storyEntry = path.resolve(process.cwd(), "bin/story.js");
    await installHooks(repoRoot, storyEntry, true);
    await writeRepoFile(repoRoot, "session.jsonl", '{"type":"user","text":"Use real hooks"}\n');
    await attachSession(repoRoot, "session.jsonl");
    await writeRepoFile(repoRoot, "feature.txt", "captured\n");
    await git(repoRoot, ["add", "feature.txt"]);
    await git(repoRoot, ["commit", "-m", "feat: real hook capture"]);

    const message = await git(repoRoot, ["log", "-1", "--pretty=%B"]);
    assert.match(message, /Story-Checkpoint: cp_/);
    const ref = "refs/heads/story/checkpoints/v1";
    const index = JSON.parse(await git(repoRoot, ["show", `${ref}:index.json`]).catch(async (error) => {
      throw new Error(`${error.message}\n${await readFile(path.join(repoRoot, ".story/runtime/hook-errors.log"), "utf8").catch(() => "")}`);
    })) as {
      checkpoints: Array<{ commit_sha: string }>;
    };
    assert.equal(index.checkpoints.length, 1);
    assert.equal(index.checkpoints[0]!.commit_sha, await git(repoRoot, ["rev-parse", "HEAD"]));
    const checkpointId = JSON.parse(
      await git(repoRoot, ["show", `${ref}:index.json`]),
    ).checkpoints[0].checkpoint_id as string;
    assert.match(
      await git(repoRoot, ["show", `${ref}:checkpoints/${checkpointId}/metadata.json`]),
      /commit_sha/,
    );
  } finally {
    await removeGitRepo(repoRoot);
  }
});
