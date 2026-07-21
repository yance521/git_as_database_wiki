import { rm } from "node:fs/promises";
import { getStoryPaths } from "./paths.ts";
import { getCurrentSession } from "./session-store.ts";
import { CheckpointWorktree } from "../git/worktree-store.ts";
import { GitRunner } from "../git/git-runner.ts";
import { sha256, readJson, writeJson } from "./utils.ts";
import type { Session } from "./models.ts";

export interface PendingCheckpoint {
  schema_version: 1;
  checkpoint_id: string;
  session: Session;
  session_ids: string[];
  session_shas: string[];
  branch: string;
  tree_sha: string;
  parent_sha: string;
  files_changed: string[];
  content_hash: string;
  created_at: string;
}

export interface Checkpoint {
  schema_version: 1;
  checkpoint_id: string;
  version: 1;
  session_ids: string[];
  session_shas: string[];
  branch: string;
  tree_sha: string;
  parent_sha: string;
  commit_sha: string;
  content_hash: string;
  created_at: string;
  files_changed: string[];
  summary: string;
  review_status: "not_generated" | "generated";
}

export async function reservePendingCheckpoint(
  repoRoot: string,
): Promise<PendingCheckpoint | null> {
  const session = await getCurrentSession(repoRoot);
  if (!session) return null;
  const runner = new GitRunner(repoRoot);
  const filesChanged = await runner.stagedFiles();
  const branch = await runner.branch();
  const parentSha = await runner.run(["rev-parse", "--verify", "HEAD"]).catch(
    () => "",
  );
  const treeSha = await runner.writeTree();
  const createdAt = new Date().toISOString();
  const identity = JSON.stringify({
    session_sha: session.session_sha,
    files_changed: filesChanged,
    branch,
    parent_sha: parentSha,
    tree_sha: treeSha,
  });
  const digest = sha256(identity).slice(7, 19);
  const sessionIds = session.session_ids?.length
    ? session.session_ids
    : [session.session_id];
  const pending: PendingCheckpoint = {
    schema_version: 1,
    checkpoint_id: `cp_${digest}_0`,
    session,
    session_ids: sessionIds,
    session_shas: [session.session_sha],
    branch,
    tree_sha: treeSha,
    parent_sha: parentSha,
    files_changed: filesChanged,
    content_hash: sha256(identity),
    created_at: createdAt,
  };
  await writeJson(getStoryPaths(repoRoot).pendingCommitFile, pending);
  return pending;
}

export async function readPendingCheckpoint(
  repoRoot: string,
): Promise<PendingCheckpoint | null> {
  return readJson<PendingCheckpoint>(
    getStoryPaths(repoRoot).pendingCommitFile,
  );
}

export async function finalizeCheckpoint(
  repoRoot: string,
): Promise<Checkpoint | null> {
  const pending = await readPendingCheckpoint(repoRoot);
  if (!pending) return null;
  const runner = new GitRunner(repoRoot);
  const commitSha = await runner.run(["rev-parse", "HEAD"]);
  const treeSha = await runner.run(["rev-parse", "HEAD^{tree}"]);
  const parentSha = await runner.run(["rev-parse", "HEAD^"]).catch(() => "");
  const message = await runner.run(["log", "-1", "--pretty=%s"]);
  const checkpoint: Checkpoint = {
    schema_version: 1,
    checkpoint_id: pending.checkpoint_id,
    version: 1,
    session_ids: pending.session_ids,
    session_shas: pending.session_shas,
    branch: pending.branch,
    tree_sha: treeSha,
    parent_sha: parentSha,
    commit_sha: commitSha,
    content_hash: pending.content_hash,
    created_at: pending.created_at,
    files_changed: pending.files_changed,
    summary: `${message} (${pending.files_changed.length} files changed)`,
    review_status: "not_generated",
  };
  const prefix = `checkpoints/${checkpoint.checkpoint_id}`;
  const ref = getStoryPaths(repoRoot).checkpointRef;
  const index = await readRefJson<{ checkpoints: Checkpoint[] }>(
    runner,
    ref,
    "index.json",
  );
  const checkpoints = [
    checkpoint,
    ...(index?.checkpoints ?? []).filter(
      (item) => item.checkpoint_id !== checkpoint.checkpoint_id,
    ),
  ];
  const transcript = pending.session.transcript;
  const files: Record<string, string> = {
    [`${prefix}/metadata.json`]: `${JSON.stringify(checkpoint, null, 2)}\n`,
    [`${prefix}/full.jsonl`]: transcript,
    [`${prefix}/prompt.txt`]: `${pending.session.prompt}\n`,
    [`${prefix}/content_hash.txt`]: `${checkpoint.content_hash}\n`,
    "index.json": `${JSON.stringify({ schema_version: 1, checkpoints }, null, 2)}\n`,
  };
  await new CheckpointWorktree(repoRoot).writeFiles(files);
  await rm(getStoryPaths(repoRoot).pendingCommitFile, { force: true });
  return checkpoint;
}

export async function findCheckpointByCommit(
  repoRoot: string,
  commitish: string,
): Promise<Checkpoint[]> {
  const runner = new GitRunner(repoRoot);
  const commitSha = await runner.run(["rev-parse", commitish]);
  const index = await readRefJson<{ checkpoints: Checkpoint[] }>(
    runner,
    getStoryPaths(repoRoot).checkpointRef,
    "index.json",
  );
  return (index?.checkpoints ?? []).filter(
    (checkpoint) => checkpoint.commit_sha === commitSha,
  );
}

export async function listCheckpoints(repoRoot: string): Promise<Checkpoint[]> {
  const runner = new GitRunner(repoRoot);
  const index = await readRefJson<{ checkpoints: Checkpoint[] }>(
    runner,
    getStoryPaths(repoRoot).checkpointRef,
    "index.json",
  );
  return index?.checkpoints ?? [];
}

export async function rebuildCheckpoint(
  repoRoot: string,
  commitish: string,
): Promise<Checkpoint | null> {
  const existing = (await findCheckpointByCommit(repoRoot, commitish))[0];
  if (existing) return existing;
  const pending = await readPendingCheckpoint(repoRoot);
  if (!pending) return null;
  const runner = new GitRunner(repoRoot);
  const target = await runner.run(["rev-parse", commitish]);
  const head = await runner.run(["rev-parse", "HEAD"]);
  if (target !== head) return null;
  return finalizeCheckpoint(repoRoot);
}

export async function rebuildCheckpointIndex(
  repoRoot: string,
): Promise<{ checkpoints: number }> {
  const runner = new GitRunner(repoRoot);
  const ref = getStoryPaths(repoRoot).checkpointRef;
  let paths: string;
  try {
    paths = await runner.run(["ls-tree", "-r", "--name-only", ref]);
  } catch {
    return { checkpoints: 0 };
  }
  const metadataPaths = paths
    .split(/\r?\n/)
    .filter((entry) => /^checkpoints\/.+\/metadata\.json$/.test(entry));
  const checkpoints: Checkpoint[] = [];
  for (const metadataPath of metadataPaths) {
    const metadata = await readRefJson<Checkpoint>(
      runner,
      ref,
      metadataPath,
    );
    if (metadata) checkpoints.push(metadata);
  }
  await new CheckpointWorktree(repoRoot).writeFiles({
    "index.json": `${JSON.stringify(
      { schema_version: 1, checkpoints },
      null,
      2,
    )}\n`,
  });
  return { checkpoints: checkpoints.length };
}

export async function loadCheckpoint(
  repoRoot: string,
  checkpointId: string,
): Promise<{ metadata: Checkpoint; transcript: string; prompt: string } | null> {
  const runner = new GitRunner(repoRoot);
  const prefix = `checkpoints/${checkpointId}`;
  const ref = getStoryPaths(repoRoot).checkpointRef;
  const metadata = await readRefJson<Checkpoint>(
    runner,
    ref,
    `${prefix}/metadata.json`,
  );
  if (!metadata) return null;
  const transcript = await runner.run(["show", `${ref}:${prefix}/full.jsonl`]);
  const prompt = await runner.run(["show", `${ref}:${prefix}/prompt.txt`]);
  return { metadata, transcript, prompt };
}

export async function updateCheckpointFiles(
  repoRoot: string,
  checkpointId: string,
  files: Record<string, string>,
): Promise<void> {
  const runner = new GitRunner(repoRoot);
  const ref = getStoryPaths(repoRoot).checkpointRef;
  const metadata = await readRefJson<Checkpoint>(
    runner,
    ref,
    `checkpoints/${checkpointId}/metadata.json`,
  );
  if (!metadata) throw new Error(`Checkpoint not found: ${checkpointId}`);
  const index = await readRefJson<{ checkpoints: Checkpoint[] }>(
    runner,
    ref,
    "index.json",
  );
  const updatedMetadata: Checkpoint = {
    ...metadata,
    review_status: files[`checkpoints/${checkpointId}/review.md`]
      ? "generated"
      : metadata.review_status,
  };
  const updatedFiles = {
    ...files,
    [`checkpoints/${checkpointId}/metadata.json`]: `${JSON.stringify(
      updatedMetadata,
      null,
      2,
    )}\n`,
    "index.json": `${JSON.stringify(
      {
        schema_version: 1,
        checkpoints: (index?.checkpoints ?? []).map((item) =>
          item.checkpoint_id === checkpointId ? updatedMetadata : item,
        ),
      },
      null,
      2,
    )}\n`,
  };
  await new CheckpointWorktree(repoRoot).writeFiles(updatedFiles);
}

async function readRefJson<T>(
  runner: GitRunner,
  ref: string,
  relativePath: string,
): Promise<T | null> {
  try {
    return JSON.parse(
      await runner.run(["show", `${ref}:${relativePath}`]),
    ) as T;
  } catch {
    return null;
  }
}
