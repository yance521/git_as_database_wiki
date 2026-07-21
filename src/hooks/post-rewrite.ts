import { sha256 } from "../core/utils.ts";
import { parseTrailers } from "../core/trailers.ts";
import { parseRewriteMappings } from "../core/lineage.ts";
import { getStoryPaths } from "../core/paths.ts";
import { GitRunner } from "../git/git-runner.ts";
import { CheckpointWorktree } from "../git/worktree-store.ts";

export async function runPostRewriteHook(
  repoRoot: string,
  input: string,
  operation = "unknown",
): Promise<{ mappings: number }> {
  const runner = new GitRunner(repoRoot);
  const mappings = parseRewriteMappings(input, operation, (newSha) => {
    return parseTrailers(
      // Git's commit message is the authoritative logical binding after rewrite.
      // The command is synchronous from the hook's perspective through this
      // preloaded cache below.
      rewriteMessages.get(newSha) ?? "",
    )["Story-Checkpoint"] ?? [];
  });
  const files: Record<string, string> = {};
  for (const mapping of mappings) {
    const eventId = sha256(
      `${mapping.old_sha}:${mapping.new_sha}:${mapping.operation}`,
    ).slice(7, 23);
    files[`lineage/${eventId}.json`] = `${JSON.stringify(mapping, null, 2)}\n`;
  }
  if (Object.keys(files).length > 0) {
    await new CheckpointWorktree(repoRoot).writeFiles(files);
  }
  return { mappings: mappings.length };
}

const rewriteMessages = new Map<string, string>();

export async function preloadRewriteMessages(
  repoRoot: string,
  input: string,
): Promise<void> {
  const runner = new GitRunner(repoRoot);
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const [, newSha] = line.trim().split(/\s+/);
    if (newSha) {
      rewriteMessages.set(
        newSha,
        await runner.run(["log", "-1", "--pretty=%B", newSha]),
      );
    }
  }
}
