export interface RewriteMapping {
  old_sha: string;
  new_sha: string;
  operation: "amend" | "rebase" | "cherry-pick" | "unknown";
  checkpoint_ids: string[];
  recorded_at: string;
}

export function parseRewriteMappings(
  input: string,
  operation: string,
  checkpointIds: (newSha: string) => string[],
): RewriteMapping[] {
  const normalizedOperation =
    operation === "amend" ||
    operation === "rebase" ||
    operation === "cherry-pick"
      ? operation
      : "unknown";
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [oldSha, newSha] = line.split(/\s+/);
      if (!/^[0-9a-f]{40}$/.test(oldSha) || !/^[0-9a-f]{40}$/.test(newSha)) {
        throw new Error(`Invalid rewrite mapping: ${line}`);
      }
      return {
        old_sha: oldSha,
        new_sha: newSha,
        operation: normalizedOperation,
        checkpoint_ids: checkpointIds(newSha),
        recorded_at: new Date().toISOString(),
      };
    });
}
