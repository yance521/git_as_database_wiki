import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCommitMsgHook } from "../../src/hooks/commit-msg.ts";
import { runPostCommitHook } from "../../src/hooks/post-commit.ts";
import { getStoryPaths } from "../../src/core/paths.ts";
import { attachSession } from "../../src/core/session-store.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
  writeRepoFile,
} from "../helpers/git-repo.ts";

test("commit hooks persist a checkpoint in the Story ref", async () => {
  const repoRoot = await createGitRepo();
  try {
    await writeRepoFile(
      repoRoot,
      "session.jsonl",
      '{"type":"user","text":"Capture this commit"}\n',
    );
    await attachSession(repoRoot, "session.jsonl");
    await writeRepoFile(repoRoot, "feature.txt", "checkpoint\n");
    await git(repoRoot, ["add", "feature.txt"]);

    const messagePath = path.join(repoRoot, "message.txt");
    await writeRepoFile(repoRoot, "message.txt", "feat: checkpoint evidence\n");
    const hookResult = await runCommitMsgHook(repoRoot, messagePath);
    assert.equal(hookResult.skipped, false);
    const message = await readFile(messagePath, "utf8");
    assert.match(message, /Story-Checkpoint: cp_/);

    await git(repoRoot, ["commit", "-q", "-F", messagePath]);
    const finalized = await runPostCommitHook(repoRoot);
    assert.equal(finalized.skipped, false);

    const ref = "refs/heads/story/checkpoints/v1";
    const metadataPath = `checkpoints/${finalized.checkpoint_id}/metadata.json`;
    const metadata = await git(repoRoot, ["show", `${ref}:${metadataPath}`]);
    assert.match(metadata, new RegExp(`"commit_sha":\\s+"[0-9a-f]{40}"`));
    assert.match(await git(repoRoot, ["show-ref", "--verify", ref]), /story\/checkpoints\/v1/);
    assert.equal(
      await readFile(getStoryPaths(repoRoot).pendingCommitFile, "utf8").catch(
        () => null,
      ),
      null,
    );
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("commit-msg hook auto-discovers a Codex session when none is manually attached", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  try {
    await writeRepoFile(repoRoot, "base.txt", "base\n");
    await git(repoRoot, ["add", "base.txt"]);
    const previousAuthorDate = process.env.GIT_AUTHOR_DATE;
    const previousCommitterDate = process.env.GIT_COMMITTER_DATE;
    process.env.GIT_AUTHOR_DATE = "2026-07-20T10:00:00.000Z";
    process.env.GIT_COMMITTER_DATE = "2026-07-20T10:00:00.000Z";
    try {
      await git(repoRoot, ["commit", "-q", "-m", "base"]);
    } finally {
      if (previousAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE;
      else process.env.GIT_AUTHOR_DATE = previousAuthorDate;
      if (previousCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE;
      else process.env.GIT_COMMITTER_DATE = previousCommitterDate;
    }
    await git(repoRoot, ["branch", "-M", "feature/story"]);

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "recent.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T10:05:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_recent",
            timestamp: "2026-07-20T10:05:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/story" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T10:06:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Auto discover me" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    await writeRepoFile(repoRoot, "feature.txt", "checkpoint\n");
    await git(repoRoot, ["add", "feature.txt"]);
    const messagePath = path.join(repoRoot, "message.txt");
    await writeRepoFile(repoRoot, "message.txt", "feat: checkpoint evidence\n");

    const previous = process.env.STORY_CODEX_HOME;
    process.env.STORY_CODEX_HOME = codexHome;
    try {
      const hookResult = await runCommitMsgHook(repoRoot, messagePath);
      assert.equal(hookResult.skipped, false);
      const message = await readFile(messagePath, "utf8");
      assert.match(message, /Story-Session: sess_/);
      assert.match(message, /Story-Checkpoint: cp_/);
    } finally {
      if (previous === undefined) delete process.env.STORY_CODEX_HOME;
      else process.env.STORY_CODEX_HOME = previous;
    }
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("commit hooks persist every raw Codex session id from an aggregate", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  try {
    await writeRepoFile(repoRoot, "base.txt", "base\n");
    await git(repoRoot, ["add", "base.txt"]);
    const previousAuthorDate = process.env.GIT_AUTHOR_DATE;
    const previousCommitterDate = process.env.GIT_COMMITTER_DATE;
    process.env.GIT_AUTHOR_DATE = "2026-07-20T10:00:00.000Z";
    process.env.GIT_COMMITTER_DATE = "2026-07-20T10:00:00.000Z";
    try {
      await git(repoRoot, ["commit", "-q", "-m", "base"]);
    } finally {
      if (previousAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE;
      else process.env.GIT_AUTHOR_DATE = previousAuthorDate;
      if (previousCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE;
      else process.env.GIT_COMMITTER_DATE = previousCommitterDate;
    }
    await git(repoRoot, ["branch", "-M", "feature/story"]);

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "codex-a.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T10:05:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "019f7f90-45c4-7be3-8ec0-a619f2308a13",
            timestamp: "2026-07-20T10:05:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/story" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T10:06:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "First Codex session" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "codex-b.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T10:07:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "019f7fa8-d7bf-7561-84b0-6a0240a675c4",
            timestamp: "2026-07-20T10:07:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/story" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T10:08:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Second Codex session" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    await writeRepoFile(repoRoot, "feature.txt", "checkpoint\n");
    await git(repoRoot, ["add", "feature.txt"]);
    const messagePath = path.join(repoRoot, "message.txt");
    await writeRepoFile(repoRoot, "message.txt", "feat: checkpoint evidence\n");

    const previous = process.env.STORY_CODEX_HOME;
    process.env.STORY_CODEX_HOME = codexHome;
    try {
      const hookResult = await runCommitMsgHook(repoRoot, messagePath);
      assert.equal(hookResult.skipped, false);
      const message = await readFile(messagePath, "utf8");
      assert.match(message, /Story-Session: 019f7f90-45c4-7be3-8ec0-a619f2308a13/);
      assert.match(message, /Story-Session: 019f7fa8-d7bf-7561-84b0-6a0240a675c4/);

      await git(repoRoot, ["commit", "-q", "-F", messagePath]);
      const finalized = await runPostCommitHook(repoRoot);
      assert.equal(finalized.skipped, false);

      const metadata = JSON.parse(
        await git(repoRoot, [
          "show",
          `refs/heads/story/checkpoints/v1:checkpoints/${finalized.checkpoint_id}/metadata.json`,
        ]),
      );
      assert.deepEqual(metadata.session_ids, [
        "019f7f90-45c4-7be3-8ec0-a619f2308a13",
        "019f7fa8-d7bf-7561-84b0-6a0240a675c4",
      ]);
    } finally {
      if (previous === undefined) delete process.env.STORY_CODEX_HOME;
      else process.env.STORY_CODEX_HOME = previous;
    }
  } finally {
    await removeGitRepo(repoRoot);
  }
});
