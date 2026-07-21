import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class GitCommandError extends Error {
  readonly args: string[];
  readonly stderr: string;
  readonly exitCode: number | undefined;

  constructor(args: string[], stderr: string, exitCode?: number) {
    super(`git ${args.join(" ")} failed${stderr ? `: ${stderr.trim()}` : ""}`);
    this.name = "GitCommandError";
    this.args = args;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export class GitRunner {
  readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  async run(
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
      const commandError = error as {
        stderr?: string;
        code?: number;
      };
      throw new GitCommandError(
        args,
        commandError.stderr ?? "",
        typeof commandError.code === "number" ? commandError.code : undefined,
      );
    }
  }

  async branch(): Promise<string> {
    return this.run(["branch", "--show-current"]);
  }

  async stagedFiles(): Promise<string[]> {
    const output = await this.run(["diff", "--staged", "--name-only"]);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  }

  async writeTree(): Promise<string> {
    return this.run(["write-tree"]);
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
