import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachSession, getCurrentSession } from "../../src/core/session-store.ts";
import {
  autoAttachCodexSession,
  listCodexSessionsByBranch,
  setLatestCodexSessionBranch,
} from "../../src/core/session-store.ts";
import {
  createGitRepo,
  git,
  removeGitRepo,
  writeRepoFile,
} from "../helpers/git-repo.ts";

test("attaches a generic JSONL transcript as the current session", async () => {
  const repoRoot = await createGitRepo();
  try {
    await writeRepoFile(
      repoRoot,
      "session.jsonl",
      '{"type":"user","text":"Build checkpoint lookup"}\r\n' +
        '{"type":"assistant","text":"I will bind it to Git trailers"}\r\n',
    );

    const session = await attachSession(repoRoot, "session.jsonl");

    assert.match(session.session_id, /^sess_/);
    assert.equal(session.source_kind, "generic-jsonl");
    assert.equal(session.prompt, "Build checkpoint lookup");
    assert.match(session.session_sha, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(await getCurrentSession(repoRoot), session);
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("does not replace an existing current session when attach validation fails", async () => {
  const repoRoot = await createGitRepo();
  try {
    await writeRepoFile(repoRoot, "valid.jsonl", '{"type":"user","text":"keep"}\n');
    await writeRepoFile(repoRoot, "invalid.jsonl", '["invalid"]\n');
    const current = await attachSession(repoRoot, "valid.jsonl");

    await assert.rejects(
      () => attachSession(repoRoot, "invalid.jsonl"),
      /line 1 must be a JSON object/,
    );

    assert.deepEqual(await getCurrentSession(repoRoot), current);
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("auto-attaches Codex sessions on the current branch after the last commit", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  const lastCommitAt = "2026-07-20T10:00:00.000Z";
  try {
    await writeRepoFile(repoRoot, "base.txt", "base\n");
    await git(repoRoot, ["add", "base.txt"]);
    const previousAuthorDate = process.env.GIT_AUTHOR_DATE;
    const previousCommitterDate = process.env.GIT_COMMITTER_DATE;
    process.env.GIT_AUTHOR_DATE = lastCommitAt;
    process.env.GIT_COMMITTER_DATE = lastCommitAt;
    try {
      await git(repoRoot, ["commit", "-q", "-m", "base"]);
    } finally {
      if (previousAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE;
      else process.env.GIT_AUTHOR_DATE = previousAuthorDate;
      if (previousCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE;
      else process.env.GIT_COMMITTER_DATE = previousCommitterDate;
    }
    await git(repoRoot, ["branch", "-M", "feature/story"]);

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "recent.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T10:05:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_recent",
            timestamp: "2026-07-20T10:05:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/story" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T10:06:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Auto attach this Codex session" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "old.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T09:00:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_old",
            timestamp: "2026-07-20T09:00:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/story" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T09:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "This one is too old" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const session = await autoAttachCodexSession(repoRoot, codexHome);

    assert.ok(session);
    assert.equal(session?.agent, "codex");
    assert.equal(session?.branch, "feature/story");
    assert.equal(session?.prompt, "Auto attach this Codex session");
    assert.match(session?.source_path ?? "", /recent\.jsonl/);
    assert.deepEqual(await getCurrentSession(repoRoot), session);
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("updates the latest Codex session branch for the current repository", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  const target = path.join(sessionDir, "latest.jsonl");
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      target,
      [
        JSON.stringify({
          timestamp: "2026-07-20T11:00:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_latest",
            timestamp: "2026-07-20T11:00:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T11:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Current Codex session" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await setLatestCodexSessionBranch(repoRoot, "feature/manual", codexHome);
    const firstLine = (await readFile(target, "utf8")).split(/\r?\n/).find(Boolean);
    const meta = JSON.parse(firstLine ?? "");

    assert.equal(result.branch, "feature/manual");
    assert.equal(result.session_id, "sess_latest");
    assert.equal(meta.payload.git.branch, "feature/manual");
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("lists Codex sessions for a specific branch in the current repository", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "feature-a.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T12:00:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_feature_a",
            timestamp: "2026-07-20T12:00:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/a" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T12:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Feature A prompt" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "feature-b.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-20T12:10:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_feature_b",
            timestamp: "2026-07-20T12:10:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
            git: { branch: "feature/b" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T12:11:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Feature B prompt" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const sessions = await listCodexSessionsByBranch(repoRoot, "feature/a", codexHome);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.session_id, "sess_feature_a");
    assert.equal(sessions[0]?.branch, "feature/a");
    assert.equal(sessions[0]?.prompt, "Feature A prompt");
    assert.match(sessions[0]?.source_path ?? "", /feature-a\.jsonl/);
  } finally {
    await removeGitRepo(repoRoot);
  }
});
