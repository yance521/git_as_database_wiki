import path from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 这个文件是 Story 的 CLI 命令分发入口。
//
// 用户执行的命令大致长这样：
//
// story enable
// story session attach ./session.jsonl
// story hook pre-push origin
// story checkpoint show --commit HEAD
//
// bin/story.js 会启动当前文件，并把用户输入的参数传给 run()。
// 当前文件不直接实现所有业务细节，而是把不同命令路由到 core / hooks / git 模块。
import { GitRunner } from "../git/git-runner.ts";

// session-store 负责“会话”相关能力：
// - 手动 attach 一份 transcript
// - 读取当前 session
// - 查找 Codex session
// - 给 Codex session 设置 branch
// - 初始化 .story/runtime 这类本地状态目录
import {
  attachSession,
  listCodexSessionsByBranch,
  setLatestCodexSessionBranch,
  getCurrentSession,
  initStoryState,
  listSessions,
} from "../core/session-store.ts";

// checkpoint-store 负责“提交证据”相关能力：
// - 根据 commit 找 checkpoint
// - 读取 checkpoint 详情
// - 列出 / 重建 checkpoint 索引
// - 在 hook 失败后尝试 repair
import {
  findCheckpointByCommit,
  loadCheckpoint,
  listCheckpoints,
  rebuildCheckpointIndex,
  rebuildCheckpoint,
  finalizeCheckpoint,
} from "../core/checkpoint-store.ts";

// review / handoff 是基于 checkpoint 派生出来的文档能力。
import { generateReview } from "../core/review.ts";
import { generateHandoff } from "../core/handoff.ts";

// paths / utils 放一些跨模块复用的小能力。
// getStoryPaths() 统一维护 .story 目录和 checkpoint ref 的位置。
// readJson() 用来读取 JSON 配置文件。
import { getStoryPaths } from "../core/paths.ts";
import { readJson } from "../core/utils.ts";

// hooks 目录里的函数对应 Git 原生 hook。
// CLI 收到 `story hook xxx` 后，会转到这些函数执行具体逻辑。
import { runCommitMsgHook } from "../hooks/commit-msg.ts";
import { runPostCommitHook } from "../hooks/post-commit.ts";
import { runPrePushHook } from "../hooks/pre-push.ts";

// install.ts 负责安装 / 卸载 Git hook wrapper。
import {
  installHooks,
  disableHooks,
} from "../hooks/install.ts";

// post-rewrite 比较特殊：Git 会把 rewrite 前后的 commit 映射从 stdin 传进来。
// 所以这里除了 runPostRewriteHook，还需要一个 preloadRewriteMessages。
import {
  preloadRewriteMessages,
  runPostRewriteHook,
} from "../hooks/post-rewrite.ts";

// run() 是 CLI 的主函数。
//
// argv:
//   用户传进来的命令参数，不包含 node 路径和脚本路径。
//   例如执行 `story session attach ./a.jsonl` 时，
//   argv 就是 ["session", "attach", "./a.jsonl"]。
//
// cwd:
//   当前工作目录，默认是 process.cwd()。
//   测试里可以手动传 cwd，这样就能在临时 Git 仓库里测试 CLI 行为。
//
// Promise<unknown>:
//   async 函数总是返回 Promise。
//   unknown 表示不同命令可能返回不同结构，例如对象、字符串或空结果。
export async function run(
  argv: string[],
  cwd = process.cwd(),
): Promise<unknown> {
  // Story 命令必须知道当前 Git 仓库根目录。
  // 即使用户在子目录执行 `story ...`，这里也会通过 Git 找到顶层目录。
  const repoRoot = await resolveRepoRoot(cwd);

  // 初始化 Story 本地状态目录。
  // 例如 .story/runtime/、current-session.json 等运行时文件需要提前准备。
  await initStoryState(repoRoot);

  // 数组解构：
  // - command 是一级命令，例如 "session"、"checkpoint"、"hook"
  // - subcommand 是二级命令，例如 "attach"、"show"、"pre-push"
  // - rest 收集剩余参数，例如 ["--commit", "HEAD"]
  const [command, subcommand, ...rest] = argv;

  // story enable [--strict]
  //
  // 安装 Story 管理的 Git hooks。
  // strict 模式表示 hook 失败时阻断 Git 操作；非 strict 模式默认尽量不打断用户工作流。
  if (command === "enable") {
    return installHooks(
      repoRoot,
      // STORY_ENTRY 是 bin/story.js 传进来的入口路径。
      // 如果没有这个环境变量，就使用 vendored mode 的默认路径：
      // <repo>/story/bin/story.js
      process.env.STORY_ENTRY ??
        path.resolve(repoRoot, "story", "bin", "story.js"),
      // rest.includes("--strict") 用来判断用户是否传了严格模式参数。
      rest.includes("--strict"),
    );
  }

  // story disable
  //
  // 卸载 Story hook wrapper，并尽量恢复用户原本的 Git hooks。
  if (command === "disable") {
    await disableHooks(repoRoot);
    return { disabled: true };
  }

  // story status
  //
  // 查看 Story 当前状态，包括安装状态、当前 session、已记录 sessions。
  if (command === "status") {
    return {
      install: await readJson(getStoryPaths(repoRoot).installFile),
      current_session: await getCurrentSession(repoRoot),
      sessions: await listSessions(repoRoot),
    };
  }

  // story session attach <path>
  //
  // 手动绑定一份 JSONL transcript，后续 commit 会把它作为证据来源。
  if (command === "session" && subcommand === "attach") {
    const source = rest[0];
    if (!source) throw new Error("Usage: story session attach <path>");
    return attachSession(repoRoot, source);
  }

  // story session status
  //
  // 查看当前已经绑定到仓库的 active session。
  if (command === "session" && subcommand === "status") {
    return getCurrentSession(repoRoot);
  }

  // story session list
  //
  // 查看本地 runtime 中记录过的 sessions。
  if (command === "session" && subcommand === "list") {
    return listSessions(repoRoot);
  }

  // story session add-codex-branch <branch>
  //
  // 给当前仓库下最新的 Codex session 写入 branch 信息。
  // Story 的 Codex 自动发现策略只会使用带 branch 的 session。
  if (command === "session" && subcommand === "add-codex-branch") {
    const branch = rest[0];
    if (!branch) {
      throw new Error("Usage: story session add-codex-branch <branch>");
    }
    return setLatestCodexSessionBranch(repoRoot, branch);
  }

  // story session list-codex --branch <branch>
  //
  // 查询指定 branch 下有哪些 Codex sessions。
  // 这里用 flag(rest, "--branch") 从参数数组里取 --branch 后面的值。
  if (command === "session" && subcommand === "list-codex") {
    const branch = flag(rest, "--branch");
    if (!branch) {
      throw new Error("Usage: story session list-codex --branch <branch>");
    }
    return listCodexSessionsByBranch(repoRoot, branch);
  }

  // story checkpoint show --commit <commitish>
  //
  // 根据 commit 找到对应 checkpoint，并把 checkpoint 里的证据 artifact 一起读出来。
  // commitish 可以是 HEAD、commit SHA、分支名等 Git 能识别的提交表达式。
  if (command === "checkpoint" && subcommand === "show") {
    // ?? 是空值合并运算符。
    // 如果用户没有传 --commit，就默认查看 HEAD。
    const commit = flag(rest, "--commit") ?? "HEAD";
    const checkpoints = await findCheckpointByCommit(repoRoot, commit);
    if (checkpoints.length === 0) {
      throw new Error(`No checkpoint found for ${commit}`);
    }
    return {
      checkpoints,
      // Promise.all 会并发读取多个 checkpoint artifact。
      // 当前大多数情况下只有一个，但保留数组结构可以兼容多 checkpoint 场景。
      artifacts: await Promise.all(
        checkpoints.map((checkpoint) =>
          loadCheckpoint(repoRoot, checkpoint.checkpoint_id),
        ),
      ),
    };
  }

  // story checkpoint list
  //
  // 列出 checkpoint ref 索引中已有的所有 checkpoints。
  if (command === "checkpoint" && subcommand === "list") {
    return { checkpoints: await listCheckpoints(repoRoot) };
  }

  // story checkpoint rebuild --commit <commitish>
  //
  // 根据已有 commit / pending 信息重建 checkpoint。
  // 这个命令用于修复索引或 hook 中断后的恢复场景。
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

  // story review generate --commit <commitish>
  //
  // 找到目标 commit 对应 checkpoint，然后基于 checkpoint 生成 review 文档。
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

  // story handoff commit --commit <commitish>
  //
  // 找到目标 commit 对应 checkpoint，然后生成上下文交接文档。
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

  // story hook commit-msg <path>
  //
  // Git commit-msg hook 会传入 commit message 文件路径。
  // Story 会读取这个文件，并在 message 中追加 Story trailers。
  if (command === "hook" && subcommand === "commit-msg") {
    const messagePath = rest[0];
    if (!messagePath) throw new Error("Usage: story hook commit-msg <path>");
    return runCommitMsgHook(repoRoot, path.resolve(repoRoot, messagePath));
  }

  // story hook post-commit
  //
  // commit 成功后触发，把 pending checkpoint 固化到 checkpoint ref。
  if (command === "hook" && subcommand === "post-commit") {
    return runPostCommitHook(repoRoot);
  }

  // story hook post-rewrite <rewrite-command>
  //
  // amend / rebase 等 rewrite 操作后触发。
  // Git 会通过 stdin 传入 old commit 到 new commit 的映射。
  if (command === "hook" && subcommand === "post-rewrite") {
    const input = await readStdin();
    await preloadRewriteMessages(repoRoot, input);
    return runPostRewriteHook(repoRoot, input, rest[0] ?? "unknown");
  }

  // story hook pre-push <remote> [url]
  //
  // 用户执行 git push 时触发。
  // Story 会把 refs/heads/story/checkpoints/v1 也同步到同一个 remote。
  if (command === "hook" && subcommand === "pre-push") {
    const remote = rest[0];
    if (!remote) throw new Error("Usage: story hook pre-push <remote> [url]");
    return runPrePushHook(repoRoot, remote);
  }

  // story repair
  //
  // 尝试完成一次未成功 finalize 的 checkpoint。
  // 适合 hook 中途失败、但 pending 信息仍然存在的恢复场景。
  if (command === "repair") {
    const repaired = await finalizeCheckpoint(repoRoot);
    return repaired
      ? { repaired: true, checkpoint_id: repaired.checkpoint_id }
      : { repaired: false, message: "No pending repair is required." };
  }

  // story index rebuild
  //
  // 重建 checkpoint 索引。用于 checkpoint ref 中已有证据，但索引损坏或缺失的场景。
  if (command === "index" && subcommand === "rebuild") {
    return rebuildCheckpointIndex(repoRoot);
  }

  // story export installable
  //
  // 把当前 Story 包打成一个可安装的 tgz，方便迁移到其他仓库。
  if (command === "export" && subcommand === "installable") {
    return exportInstallable(repoRoot);
  }

  // 所有已知命令都不匹配时，给用户一个明确错误。
  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

// 导出一个可安装包。
//
// 返回值是 { archive: string }，其中 archive 是生成出来的 tgz 文件路径。
async function exportInstallable(repoRoot: string): Promise<{ archive: string }> {
  // 优先使用 STORY_ENTRY，因为它代表当前真实启动入口。
  // 如果没有这个环境变量，就使用 vendored mode 默认入口。
  const storyEntry =
    process.env.STORY_ENTRY ??
    path.resolve(repoRoot, "story", "bin", "story.js");

  // storyEntry 指向 bin/story.js。
  // packageRoot 要回到包根目录，也就是 bin 的上一级目录。
  const packageRoot = path.resolve(path.dirname(storyEntry), "..");

  // tgz 输出到当前仓库的 .story/generated/ 目录下。
  const output = path.join(
    repoRoot,
    ".story",
    "generated",
    "story-installable.tgz",
  );

  // Node 的 execFile 是回调风格 API。
  // promisify(execFile) 会把它转成 Promise 风格，方便配合 await 使用。
  //
  // 这里等价于执行：
  // tar -czf <output> -C <package-parent> <package-dir-name>
  await promisify(execFile)("tar", [
    "-czf",
    output,
    "-C",
    path.dirname(packageRoot),
    path.basename(packageRoot),
  ]);
  return { archive: output };
}

// 找到当前命令所在的 Git 仓库根目录。
//
// git rev-parse --show-toplevel 会返回仓库顶层路径。
// 例如你在 src/cli 目录里执行命令，它仍然会返回项目根目录。
async function resolveRepoRoot(cwd: string): Promise<string> {
  return new GitRunner(cwd).run(["rev-parse", "--show-toplevel"]);
}

// 很多命令都需要“先根据 commit 找到唯一 checkpoint”。
// 这个辅助函数把重复逻辑收敛起来：
// - 找不到就抛错
// - 找到就返回第一个 checkpoint
async function resolveOneCheckpoint(repoRoot: string, commitish: string) {
  const checkpoints = await findCheckpointByCommit(repoRoot, commitish);
  const checkpoint = checkpoints[0];
  if (!checkpoint) throw new Error(`No checkpoint found for ${commitish}`);
  return checkpoint;
}

// 一个非常轻量的命令行 flag 解析函数。
//
// 例如：
// args = ["--commit", "HEAD", "--json"]
// flag(args, "--commit") => "HEAD"
// flag(args, "--branch") => null
//
// 这个项目命令参数比较简单，所以没有引入 commander / yargs 这类 CLI 框架。
function flag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

// 读取标准输入 stdin。
//
// post-rewrite hook 比较特殊：
// Git 会把 old commit / new commit 的映射写到 stdin，
// Story 需要把这些内容读出来，才能记录 rewrite lineage。
async function readStdin(): Promise<string> {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

// import.meta.main 表示“当前文件是否是被直接执行的入口文件”。
//
// 如果这个文件是被测试代码 import 的，就不会进入这里；
// 如果是 bin/story.js 启动了这个文件，就会进入这里并真正执行 CLI。
if (import.meta.main) {
  // process.argv.slice(2) 去掉前两个系统参数：
  // - process.argv[0]: node 可执行文件路径
  // - process.argv[1]: 当前脚本路径
  //
  // 剩下的才是用户输入的 Story 命令参数。
  run(process.argv.slice(2))
    .then((result) => {
      if (result !== undefined) {
        // --json 表示用户想拿机器可读输出。
        // 没有 --json 时，formatResult 会尽量输出更简单的人类可读文本。
        process.stdout.write(formatResult(result, process.argv.includes("--json")));
      }
    })
    .catch((error: Error) => {
      // CLI 出错时写 stderr，并设置 process.exitCode = 1。
      // 这样 shell / Git hook 能知道命令失败了。
      process.stderr.write(`Story error: ${error.message}\n`);
      process.exitCode = 1;
    });
}

// 统一格式化 CLI 输出。
//
// json = true:
//   永远输出格式化 JSON，方便脚本或 Agent 解析。
//
// json = false:
//   尽量输出更自然的人类可读内容。
function formatResult(result: unknown, json: boolean): string {
  // JSON.stringify(value, null, 2) 会输出带缩进的 JSON。
  if (json) return `${JSON.stringify(result, null, 2)}\n`;

  // 字符串结果直接输出即可。
  if (typeof result === "string") return `${result}\n`;

  // null / undefined 表示没有实质返回值。
  if (result === null || result === undefined) return "No result.\n";

  // 如果返回对象里有 message 字段，优先把 message 当作人类可读摘要输出。
  if (typeof result === "object" && "message" in result) {
    return `${String((result as { message: unknown }).message)}\n`;
  }

  // 其他复杂对象默认输出 JSON，避免丢信息。
  return `${JSON.stringify(result, null, 2)}\n`;
}
