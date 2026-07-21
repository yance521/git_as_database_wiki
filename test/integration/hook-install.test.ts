import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { installHooks, disableHooks } from "../../src/hooks/install.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
} from "../helpers/git-repo.ts";

test("enable chains an existing hook and disable restores it", async () => {
  const repoRoot = await createGitRepo();
  try {
    const gitDir = await git(repoRoot, ["rev-parse", "--git-dir"]);
    const originalPath = path.join(repoRoot, gitDir, "hooks", "commit-msg");
    const original = "#!/bin/sh\necho original-hook >> hook.log\n";
    await writeFile(originalPath, original, "utf8");
    await chmod(originalPath, 0o755);

    await installHooks(repoRoot, path.resolve(process.cwd(), "bin/story.js"));
    const managed = await readFile(originalPath, "utf8");
    assert.match(managed, /story-managed-hook-v1/);
    assert.match(managed, /original\/commit-msg/);
    assert.match(await readFile(path.join(repoRoot, ".gitignore"), "utf8"), /\.story\/runtime\//);

    await disableHooks(repoRoot);
    assert.equal(await readFile(originalPath, "utf8"), original);
  } finally {
    await removeGitRepo(repoRoot);
  }
});
