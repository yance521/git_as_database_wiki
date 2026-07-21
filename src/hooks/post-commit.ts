import { finalizeCheckpoint } from "../core/checkpoint-store.ts";
import type { HookResult } from "./commit-msg.ts";

export async function runPostCommitHook(repoRoot: string): Promise<
  HookResult & { checkpoint_id?: string }
> {
  const checkpoint = await finalizeCheckpoint(repoRoot);
  return checkpoint
    ? { skipped: false, checkpoint_id: checkpoint.checkpoint_id }
    : { skipped: true, reason: "no pending checkpoint" };
}
