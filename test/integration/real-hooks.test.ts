import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { attachSession } from "../../src/core/session-store.ts";
import { installHooks } from "../../src/hooks/install.ts";
import { createGitRepo, git, removeGitRepo, writeRepoFile } from "../helpers/git-repo.ts";

const execFileAsync = promisify(execFile);

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

test("installed pre-push hook pushes the Story checkpoint ref with business code", async () => {
  const repoRoot = await createGitRepo();
  const remoteRoot = await mkdtemp(path.join(os.tmpdir(), "story-remote-"));
  try {
    await execFileAsync("git", ["init", "--bare", "-q", remoteRoot]);
    await git(repoRoot, ["branch", "-M", "main"]);
    await git(repoRoot, ["remote", "add", "origin", remoteRoot]);

    const storyEntry = path.resolve(process.cwd(), "bin/story.js");
    await installHooks(repoRoot, storyEntry, true);
    await writeRepoFile(repoRoot, "session.jsonl", '{"type":"user","text":"Push Story ref"}\n');
    await attachSession(repoRoot, "session.jsonl");
    await writeRepoFile(repoRoot, "feature.txt", "push me\n");
    await git(repoRoot, ["add", "feature.txt"]);
    await git(repoRoot, ["commit", "-m", "feat: push story ref"]);

    await git(repoRoot, ["push", "origin", "main"]);

    const storyRef = await execFileAsync("git", [
      "--git-dir",
      remoteRoot,
      "show-ref",
      "--verify",
      "refs/heads/story/checkpoints/v1",
    ]);
    assert.match(storyRef.stdout, /refs\/heads\/story\/checkpoints\/v1/);
  } finally {
    await removeGitRepo(repoRoot);
    await removeGitRepo(remoteRoot);
  }
});
