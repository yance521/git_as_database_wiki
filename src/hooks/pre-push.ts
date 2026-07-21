import { GitRunner } from "../git/git-runner.ts";
import { getStoryPaths } from "../core/paths.ts";

export interface PrePushHookResult {
  skipped: boolean;
  reason?: string;
  remote?: string;
  ref?: string;
}

export async function runPrePushHook(
  repoRoot: string,
  remote: string,
): Promise<PrePushHookResult> {
  if (process.env.STORY_SYNCING_CHECKPOINTS === "1") {
    return { skipped: true, reason: "checkpoint sync already in progress" };
  }
  if (!remote) {
    return { skipped: true, reason: "no remote provided" };
  }

  const runner = new GitRunner(repoRoot);
  const checkpointRef = getStoryPaths(repoRoot).checkpointRef;
  const hasCheckpointRef = await runner
    .run(["show-ref", "--verify", "--quiet", checkpointRef])
    .then(() => true)
    .catch(() => false);
  if (!hasCheckpointRef) {
    return { skipped: true, reason: "no checkpoint ref" };
  }

  await runner.run(
    ["push", remote, `${checkpointRef}:${checkpointRef}`],
    { STORY_SYNCING_CHECKPOINTS: "1" },
  );

  return {
    skipped: false,
    remote,
    ref: checkpointRef,
  };
}
