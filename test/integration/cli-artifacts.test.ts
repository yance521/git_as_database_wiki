import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { run } from "../../src/cli/main.ts";
import { attachSession } from "../../src/core/session-store.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
  writeRepoFile,
} from "../helpers/git-repo.ts";
import { installHooks } from "../../src/hooks/install.ts";

test("CLI shows a checkpoint and writes review and handoff into the ref", async () => {
  const repoRoot = await createGitRepo();
  try {
    await installHooks(repoRoot, path.resolve(process.cwd(), "bin/story.js"), true);
    await writeRepoFile(
      repoRoot,
      "session.jsonl",
      '{"type":"user","text":"Review the checkpoint intent"}\n',
    );
    await attachSession(repoRoot, "session.jsonl");
    await writeRepoFile(repoRoot, "feature.txt", "artifact\n");
    await git(repoRoot, ["add", "feature.txt"]);
    await git(repoRoot, ["commit", "-m", "feat: artifact"]);
    assert.match(await git(repoRoot, ["log", "-1", "--pretty=%B"]), /Story-Checkpoint: cp_/);
    const shown = (await run(["checkpoint", "show", "--commit", "HEAD"], repoRoot)) as {
      checkpoints: Array<{ checkpoint_id: string }>;
    };
    assert.equal(shown.checkpoints.length, 1);
    const checkpointId = shown.checkpoints[0]!.checkpoint_id;
    assert.equal(
      ((await run(["checkpoint", "rebuild", "--commit", "HEAD"], repoRoot) as {
        checkpoint: { checkpoint_id: string };
      }).checkpoint).checkpoint_id,
      checkpointId,
    );

    await run(["review", "generate", "--commit", "HEAD"], repoRoot);
    await run(["handoff", "commit", "--commit", "HEAD"], repoRoot);
    const ref = "refs/heads/story/checkpoints/v1";
    assert.match(
      await git(repoRoot, [
        "show",
        `${ref}:checkpoints/${checkpointId}/review.md`,
      ]),
      /Intent Review/,
    );
    assert.match(
      await git(repoRoot, [
        "show",
        `${ref}:checkpoints/${checkpointId}/handoff.md`,
      ]),
      /Next Steps/,
    );
  } finally {
    await removeGitRepo(repoRoot);
  }
});
