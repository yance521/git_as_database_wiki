import {
  loadCheckpoint,
  updateCheckpointFiles,
} from "./checkpoint-store.ts";

export async function generateReview(
  repoRoot: string,
  checkpointId: string,
): Promise<string> {
  const artifacts = await loadCheckpoint(repoRoot, checkpointId);
  if (!artifacts) throw new Error(`Checkpoint not found: ${checkpointId}`);
  const { metadata, prompt, transcript } = artifacts;
  const output = `# Story Review: ${metadata.commit_sha}

## Intent Review

- Original objective: ${prompt || "Not extracted"}
- Sessions: ${metadata.session_ids.join(", ")}
- Files changed: ${metadata.files_changed.join(", ") || "none"}

## Execution Review

- Commit: \`${metadata.commit_sha}\`
- Branch: \`${metadata.branch}\`
- Summary: ${metadata.summary}
- Tree: \`${metadata.tree_sha}\`

## Transcript Evidence

\`\`\`jsonl
${transcript.trimEnd()}
\`\`\`

## Reviewer Checklist

- [ ] Requirement fit
- [ ] Intent drift
- [ ] Risk hotspots
- [ ] Tests and evidence
`;
  await updateCheckpointFiles(repoRoot, checkpointId, {
    [`checkpoints/${checkpointId}/review.md`]: output,
  });
  return output;
}
