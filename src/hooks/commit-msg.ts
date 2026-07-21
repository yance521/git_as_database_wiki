import { readFile, writeFile } from "node:fs/promises";
import { reservePendingCheckpoint } from "../core/checkpoint-store.ts";
import { appendMissingTrailers } from "../core/trailers.ts";
import { autoAttachCodexSession, getCurrentSession } from "../core/session-store.ts";

export interface HookResult {
  skipped: boolean;
  reason?: string;
  checkpoint_id?: string;
}

export async function runCommitMsgHook(
  repoRoot: string,
  messagePath: string,
): Promise<HookResult> {
  const session =
    (await getCurrentSession(repoRoot)) ??
    (await autoAttachCodexSession(repoRoot));
  if (!session) return { skipped: true, reason: "no session attached" };
  const pending = await reservePendingCheckpoint(repoRoot);
  if (!pending) return { skipped: true, reason: "no pending checkpoint" };
  const message = await readFile(messagePath, "utf8");
  const updated = appendMissingTrailers(
    message,
    session,
    pending.checkpoint_id,
    pending.content_hash,
  );
  if (updated !== message) await writeFile(messagePath, updated, "utf8");
  return { skipped: false, checkpoint_id: pending.checkpoint_id };
}
