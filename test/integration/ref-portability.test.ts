import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHooks } from "../../src/hooks/install.ts";
import { attachSession } from "../../src/core/session-store.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
  writeRepoFile,
} from "../helpers/git-repo.ts";

const execFileAsync = promisify(execFile);

test("checkpoint ref is readable after cloning the repository", async () => {
  const repoRoot = await createGitRepo();
  const cloneParent = await mkdtemp(path.join(os.tmpdir(), "story-clone-"));
  try {
    await installHooks(repoRoot, path.resolve(process.cwd(), "bin/story.js"));
    await writeFile(
      path.join(repoRoot, "session.jsonl"),
      '{"type":"user","text":"Portable evidence"}\n',
      "utf8",
    );
    await attachSession(repoRoot, "session.jsonl");
    await writeRepoFile(repoRoot, "feature.txt", "portable\n");
    await git(repoRoot, ["add", "feature.txt"]);
    await git(repoRoot, ["commit", "-qm", "feat: portable evidence"]);

    const cloneRoot = path.join(cloneParent, "clone");
    await execFileAsync("git", ["clone", "-q", repoRoot, cloneRoot]);
    await git(cloneRoot, [
      "fetch",
      "origin",
      "refs/heads/story/checkpoints/v1:refs/heads/story/checkpoints/v1",
    ]);
    const ref = await git(cloneRoot, [
      "show-ref",
      "--verify",
      "refs/heads/story/checkpoints/v1",
    ]);
    assert.match(ref, /story\/checkpoints\/v1/);
    assert.match(
      await git(cloneRoot, ["show", "refs/heads/story/checkpoints/v1:index.json"]),
      /portable evidence/,
    );
  } finally {
    await removeGitRepo(repoRoot);
    await rm(cloneParent, { recursive: true, force: true });
  }
});
