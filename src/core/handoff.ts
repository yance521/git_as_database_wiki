import {
  loadCheckpoint,
  updateCheckpointFiles,
} from "./checkpoint-store.ts";

export interface HandoffInput {
  checkpoint_id: string;
  commit_sha: string;
  prompt: string;
  summary: string;
  files_changed: string[];
  transcript: string;
}

export function renderHandoff(input: HandoffInput): string {
  return `# Story Handoff: ${input.commit_sha}

## Objective

${input.prompt || "No original prompt was extracted."}

## Current State

- Checkpoint: \`${input.checkpoint_id}\`
- Commit: \`${input.commit_sha}\`
- Files changed: ${input.files_changed.join(", ") || "none"}
- Summary: ${input.summary}

## Completed Work

The commit-linked checkpoint and transcript evidence are stored in the Story
checkpoint ref.

## Unresolved Questions

- Review implementation risks and test evidence before continuing.

## Next Steps

1. Inspect the linked commit and generated review.
2. Verify tests and remaining requirements.
3. Continue from the checkpoint context.
`;
}

export async function generateHandoff(
  repoRoot: string,
  checkpointId: string,
): Promise<string> {
  const artifacts = await loadCheckpoint(repoRoot, checkpointId);
  if (!artifacts) throw new Error(`Checkpoint not found: ${checkpointId}`);
  const { metadata, prompt } = artifacts;
  const output = renderHandoff({
    checkpoint_id: metadata.checkpoint_id,
    commit_sha: metadata.commit_sha,
    prompt,
    summary: metadata.summary,
    files_changed: metadata.files_changed,
    transcript: artifacts.transcript,
  });
  await updateCheckpointFiles(repoRoot, checkpointId, {
    [`checkpoints/${checkpointId}/handoff.md`]: output,
  });
  return output;
}
