import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { run } from "../../src/cli/main.ts";
import { createGitRepo, removeGitRepo } from "../helpers/git-repo.ts";

const execFileAsync = promisify(execFile);

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

test("npm package runs after installing into node_modules", async () => {
  const repoRoot = await createGitRepo();
  try {
    const pack = await execFileAsync(
      "npm",
      ["pack", "--pack-destination", repoRoot],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    const archiveName = pack.stdout.trim().split(/\r?\n/).at(-1);
    assert.ok(archiveName);
    const archivePath = path.join(repoRoot, archiveName);

    await execFileAsync("npm", ["init", "-y"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    await execFileAsync("npm", ["install", archivePath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const storyBin = path.join(repoRoot, "node_modules", ".bin", "story");
    const status = await execFileAsync(storyBin, ["status", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.match(status.stdout, /"current_session"/);
  } finally {
    await removeGitRepo(repoRoot);
  }
});
