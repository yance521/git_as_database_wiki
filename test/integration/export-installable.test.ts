import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { run } from "../../src/cli/main.ts";
import { createGitRepo, removeGitRepo } from "../helpers/git-repo.ts";

test("export installable creates a portable archive", async () => {
  const repoRoot = await createGitRepo();
  const previousEntry = process.env.STORY_ENTRY;
  try {
    process.env.STORY_ENTRY = path.resolve(process.cwd(), "bin/story.js");
    const result = (await run(["export", "installable"], repoRoot)) as {
      archive: string;
    };
    assert.equal(path.basename(result.archive), "story-installable.tgz");
    await access(result.archive);
  } finally {
    if (previousEntry === undefined) delete process.env.STORY_ENTRY;
    else process.env.STORY_ENTRY = previousEntry;
    await removeGitRepo(repoRoot);
  }
});
