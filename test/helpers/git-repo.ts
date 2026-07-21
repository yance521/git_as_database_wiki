import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createGitRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "story-test-"));
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Story Test"]);
  await git(root, ["config", "user.email", "story@example.test"]);
  return root;
}

export async function writeRepoFile(
  repoRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(repoRoot, relativePath);
  await writeFile(target, content, "utf8");
}

export async function git(repoRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    env: process.env,
  });
  return result.stdout.trim();
}

export async function removeGitRepo(repoRoot: string): Promise<void> {
  await rm(repoRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  });
}
