import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitRunner } from "../git/git-runner.ts";
import { getStoryPaths } from "../core/paths.ts";
import { ensureDir, writeJson } from "../core/utils.ts";

const MANAGED_MARKER = "# story-managed-hook-v1";
const HOOKS = ["commit-msg", "post-commit", "post-rewrite"] as const;

export async function installHooks(
  repoRoot: string,
  storyEntry: string,
  strict = false,
): Promise<{ hooks: string[]; strict: boolean }> {
  const runner = new GitRunner(repoRoot);
  const gitDirValue = await runner.run(["rev-parse", "--git-dir"]);
  const gitDir = path.isAbsolute(gitDirValue)
    ? gitDirValue
    : path.resolve(repoRoot, gitDirValue);
  const paths = getStoryPaths(repoRoot);
  const originalDir = path.join(paths.hooksDir, "original");
  await ensureDir(originalDir);
  await ensureStoryGitignore(repoRoot);

  for (const hook of HOOKS) {
    const target = path.join(gitDir, "hooks", hook);
    const original = path.join(originalDir, hook);
    let existing = "";
    try {
      existing = await readFile(target, "utf8");
    } catch {
      existing = "";
    }
    if (existing && !existing.includes(MANAGED_MARKER)) {
      await copyFile(target, original);
    }
    await writeFile(
      target,
      renderWrapper(repoRoot, storyEntry, hook, original, strict),
      "utf8",
    );
    await chmod(target, 0o755);
  }
  await writeJson(paths.installFile, {
    schema_version: 1,
    enabled: true,
    strict,
    story_entry: storyEntry,
    hooks: [...HOOKS],
  });
  return { hooks: [...HOOKS], strict };
}

async function ensureStoryGitignore(repoRoot: string): Promise<void> {
  const filePath = path.join(repoRoot, ".gitignore");
  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    current = "";
  }
  const entries = [
    ".story/runtime/",
    ".story/cache/",
    ".story/generated/",
    ".story/logs/",
    ".story/hooks/",
  ];
  const missing = entries.filter((entry) => !current.split(/\r?\n/).includes(entry));
  if (missing.length === 0) return;
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
  await writeFile(
    filePath,
    `${prefix}\n# Story local runtime\n${missing.join("\n")}\n`,
    "utf8",
  );
}

export async function disableHooks(repoRoot: string): Promise<void> {
  const runner = new GitRunner(repoRoot);
  const gitDirValue = await runner.run(["rev-parse", "--git-dir"]);
  const gitDir = path.isAbsolute(gitDirValue)
    ? gitDirValue
    : path.resolve(repoRoot, gitDirValue);
  const originalDir = path.join(getStoryPaths(repoRoot).hooksDir, "original");
  for (const hook of HOOKS) {
    const target = path.join(gitDir, "hooks", hook);
    const original = path.join(originalDir, hook);
    try {
      const targetText = await readFile(target, "utf8");
      if (!targetText.includes(MANAGED_MARKER)) continue;
      try {
        await copyFile(original, target);
      } catch {
        const { rm } = await import("node:fs/promises");
        await rm(target, { force: true });
      }
    } catch {
      // A missing hook is already disabled.
    }
  }
  await writeJson(getStoryPaths(repoRoot).installFile, {
    schema_version: 1,
    enabled: false,
    hooks: [],
  });
}

function renderWrapper(
  repoRoot: string,
  storyEntry: string,
  hook: string,
  original: string,
  strict: boolean,
): string {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const args = '"$@"';
  return `#!/bin/sh
${MANAGED_MARKER}
set -u
if [ "\${STORY_INTERNAL_COMMIT:-0}" = "1" ]; then
  exit 0
fi
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$repo_root" || exit 1
log_file="$repo_root/.story/runtime/hook-errors.log"
mkdir -p "$(dirname "$log_file")"
echo "Story ${hook} hook invoked" >>"$log_file"
if [ -f ${quote(original)} ]; then
  sh ${quote(original)} ${args} || exit $?
fi
if node ${quote(storyEntry)} hook ${hook} ${args} 2>>"$log_file"; then
  :
else
  status=$?
  echo "Story ${hook} hook failed (status $status)" >&2
  echo "Story ${hook} hook failed (status $status)" >>"$log_file"
  ${strict ? "exit $status" : "exit 0"}
fi
exit 0
`;
}
