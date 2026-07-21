import path from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitRunner } from "../git/git-runner.ts";
import {
  attachSession,
  listCodexSessionsByBranch,
  setLatestCodexSessionBranch,
  getCurrentSession,
  initStoryState,
  listSessions,
} from "../core/session-store.ts";
import {
  findCheckpointByCommit,
  loadCheckpoint,
  listCheckpoints,
  rebuildCheckpointIndex,
  rebuildCheckpoint,
  finalizeCheckpoint,
} from "../core/checkpoint-store.ts";
import { generateReview } from "../core/review.ts";
import { generateHandoff } from "../core/handoff.ts";
import { getStoryPaths } from "../core/paths.ts";
import { readJson } from "../core/utils.ts";
import { runCommitMsgHook } from "../hooks/commit-msg.ts";
import { runPostCommitHook } from "../hooks/post-commit.ts";
import { runPrePushHook } from "../hooks/pre-push.ts";
import {
  installHooks,
  disableHooks,
} from "../hooks/install.ts";
import {
  preloadRewriteMessages,
  runPostRewriteHook,
} from "../hooks/post-rewrite.ts";

export async function run(
  argv: string[],
  cwd = process.cwd(),
): Promise<unknown> {
  const repoRoot = await resolveRepoRoot(cwd);
  await initStoryState(repoRoot);
  const [command, subcommand, ...rest] = argv;

  if (command === "enable") {
    return installHooks(
      repoRoot,
      process.env.STORY_ENTRY ??
        path.resolve(repoRoot, "story", "bin", "story.js"),
      rest.includes("--strict"),
    );
  }
  if (command === "disable") {
    await disableHooks(repoRoot);
    return { disabled: true };
  }
  if (command === "status") {
    return {
      install: await readJson(getStoryPaths(repoRoot).installFile),
      current_session: await getCurrentSession(repoRoot),
      sessions: await listSessions(repoRoot),
    };
  }
  if (command === "session" && subcommand === "attach") {
    const source = rest[0];
    if (!source) throw new Error("Usage: story session attach <path>");
    return attachSession(repoRoot, source);
  }
  if (command === "session" && subcommand === "status") {
    return getCurrentSession(repoRoot);
  }
  if (command === "session" && subcommand === "list") {
    return listSessions(repoRoot);
  }
  if (command === "session" && subcommand === "add-codex-branch") {
    const branch = rest[0];
    if (!branch) {
      throw new Error("Usage: story session add-codex-branch <branch>");
    }
    return setLatestCodexSessionBranch(repoRoot, branch);
  }
  if (command === "session" && subcommand === "list-codex") {
    const branch = flag(rest, "--branch");
    if (!branch) {
      throw new Error("Usage: story session list-codex --branch <branch>");
    }
    return listCodexSessionsByBranch(repoRoot, branch);
  }
  if (command === "checkpoint" && subcommand === "show") {
    const commit = flag(rest, "--commit") ?? "HEAD";
    const checkpoints = await findCheckpointByCommit(repoRoot, commit);
    if (checkpoints.length === 0) {
      throw new Error(`No checkpoint found for ${commit}`);
    }
    return {
      checkpoints,
      artifacts: await Promise.all(
        checkpoints.map((checkpoint) =>
          loadCheckpoint(repoRoot, checkpoint.checkpoint_id),
        ),
      ),
    };
  }
  if (command === "checkpoint" && subcommand === "list") {
    return { checkpoints: await listCheckpoints(repoRoot) };
  }
  if (command === "checkpoint" && subcommand === "rebuild") {
    const rebuilt = await rebuildCheckpoint(
      repoRoot,
      flag(rest, "--commit") ?? "HEAD",
    );
    return {
      checkpoints: rebuilt ? 1 : 0,
      checkpoint_id: rebuilt?.checkpoint_id,
      checkpoint: rebuilt,
    };
  }
  if (command === "review" && subcommand === "generate") {
    const checkpoint = await resolveOneCheckpoint(
      repoRoot,
      flag(rest, "--commit") ?? "HEAD",
    );
    return {
      checkpoint_id: checkpoint.checkpoint_id,
      output: await generateReview(repoRoot, checkpoint.checkpoint_id),
    };
  }
  if (command === "handoff" && subcommand === "commit") {
    const checkpoint = await resolveOneCheckpoint(
      repoRoot,
      flag(rest, "--commit") ?? "HEAD",
    );
    return {
      checkpoint_id: checkpoint.checkpoint_id,
      output: await generateHandoff(repoRoot, checkpoint.checkpoint_id),
    };
  }
  if (command === "hook" && subcommand === "commit-msg") {
    const messagePath = rest[0];
    if (!messagePath) throw new Error("Usage: story hook commit-msg <path>");
    return runCommitMsgHook(repoRoot, path.resolve(repoRoot, messagePath));
  }
  if (command === "hook" && subcommand === "post-commit") {
    return runPostCommitHook(repoRoot);
  }
  if (command === "hook" && subcommand === "post-rewrite") {
    const input = await readStdin();
    await preloadRewriteMessages(repoRoot, input);
    return runPostRewriteHook(repoRoot, input, rest[0] ?? "unknown");
  }
  if (command === "hook" && subcommand === "pre-push") {
    const remote = rest[0];
    if (!remote) throw new Error("Usage: story hook pre-push <remote> [url]");
    return runPrePushHook(repoRoot, remote);
  }
  if (command === "repair") {
    const repaired = await finalizeCheckpoint(repoRoot);
    return repaired
      ? { repaired: true, checkpoint_id: repaired.checkpoint_id }
      : { repaired: false, message: "No pending repair is required." };
  }
  if (command === "index" && subcommand === "rebuild") {
    return rebuildCheckpointIndex(repoRoot);
  }
  if (command === "export" && subcommand === "installable") {
    return exportInstallable(repoRoot);
  }
  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

async function exportInstallable(repoRoot: string): Promise<{ archive: string }> {
  const storyEntry =
    process.env.STORY_ENTRY ??
    path.resolve(repoRoot, "story", "bin", "story.js");
  const packageRoot = path.resolve(path.dirname(storyEntry), "..");
  const output = path.join(
    repoRoot,
    ".story",
    "generated",
    "story-installable.tgz",
  );
  await promisify(execFile)("tar", [
    "-czf",
    output,
    "-C",
    path.dirname(packageRoot),
    path.basename(packageRoot),
  ]);
  return { archive: output };
}

async function resolveRepoRoot(cwd: string): Promise<string> {
  return new GitRunner(cwd).run(["rev-parse", "--show-toplevel"]);
}

async function resolveOneCheckpoint(repoRoot: string, commitish: string) {
  const checkpoints = await findCheckpointByCommit(repoRoot, commitish);
  const checkpoint = checkpoints[0];
  if (!checkpoint) throw new Error(`No checkpoint found for ${commitish}`);
  return checkpoint;
}

function flag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

async function readStdin(): Promise<string> {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((result) => {
      if (result !== undefined) {
        process.stdout.write(formatResult(result, process.argv.includes("--json")));
      }
    })
    .catch((error: Error) => {
      process.stderr.write(`Story error: ${error.message}\n`);
      process.exitCode = 1;
    });
}

function formatResult(result: unknown, json: boolean): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  if (typeof result === "string") return `${result}\n`;
  if (result === null || result === undefined) return "No result.\n";
  if (typeof result === "object" && "message" in result) {
    return `${String((result as { message: unknown }).message)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}
