import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitRunner } from "./git-runner.ts";

const execFileAsync = promisify(execFile);

export class CheckpointWorktree {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  async writeFiles(files: Record<string, string>): Promise<void> {
    const lockPath = path.join(
      this.repoRoot,
      ".story",
      "runtime",
      "locks",
      "checkpoint-ref.lock",
    );
    await mkdir(path.dirname(lockPath), { recursive: true });
    try {
      await mkdir(lockPath);
    } catch {
      throw new Error("Story checkpoint ref is locked by another operation");
    }
    const branch = `story-tmp-${process.pid}-${Date.now()}`;
    const runner = new GitRunner(this.repoRoot);
    const ref = "refs/heads/story/checkpoints/v1";
    let worktree = "";
    let attached = false;
    try {
      worktree = await mkdtemp(path.join(os.tmpdir(), "story-ref-"));
      const hasRef = await this.hasRef(runner, ref);
      const startPoint = hasRef
        ? ref
        : await runner.run(["rev-parse", "--verify", "HEAD"]);
      await this.run(["worktree", "add", "--detach", worktree, startPoint]);
      attached = true;
      const temp = new GitRunner(worktree);
      if (hasRef) {
        await temp.run(["switch", "-c", branch]);
      } else {
        await temp.run(["switch", "--orphan", branch]);
        await temp.run(["rm", "-r", "--force", "."]).catch(() => "");
      }
      for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(worktree, relativePath);
        await this.writeFile(target, content);
      }
      await temp.run(["add", "--all"]);
      const hasChanges = await temp
        .run(["diff", "--cached", "--quiet"])
        .then(() => false)
        .catch(() => true);
      if (!hasChanges) {
        return;
      }
      await temp.run([
        "-c",
        "user.name=Story",
        "-c",
        "user.email=story@localhost",
        "commit",
        "-m",
        "story: update checkpoint evidence",
      ], { STORY_INTERNAL_COMMIT: "1" });
      const head = await temp.run(["rev-parse", "HEAD"]);
      await this.run(["update-ref", ref, head]);
    } finally {
      if (attached) {
        await this.run(["worktree", "remove", "--force", worktree]).catch(
          () => undefined,
        );
      }
      await this.run(["branch", "-D", branch]).catch(() => undefined);
      if (worktree) {
        await rm(worktree, { recursive: true, force: true });
      }
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private async hasRef(runner: GitRunner, ref: string): Promise<boolean> {
    return runner.run(["show-ref", "--verify", "--quiet", ref]).then(
      () => true,
      () => false,
    );
  }

  private async run(
    args: string[],
    environment: Record<string, string> = {},
  ): Promise<string> {
    try {
      const result = await execFileAsync("git", ["-C", this.repoRoot, ...args], {
        encoding: "utf8",
        env: { ...cleanGitEnvironment(), ...environment },
      });
      return result.stdout.trim();
    } catch (error) {
      const commandError = error as { stderr?: string };
      throw new Error(
        `git ${args.join(" ")} failed: ${(commandError.stderr ?? "").trim()}`,
      );
    }
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.dirname(filePath), { recursive: true }),
    );
    await writeFile(filePath, content, "utf8");
  }
}

function cleanGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  return env;
}
