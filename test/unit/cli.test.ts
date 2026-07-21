import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { run } from "../../src/cli/main.ts";
import { createGitRepo, removeGitRepo, writeRepoFile } from "../helpers/git-repo.ts";

const execFileAsync = promisify(execFile);

test("CLI session attach emits stable JSON and records the current session", async () => {
  const repoRoot = await createGitRepo();
  try {
    await writeRepoFile(
      repoRoot,
      "session.jsonl",
      '{"type":"user","text":"Capture this session"}\n',
    );
    const parsed = (await run(["session", "attach", "session.jsonl", "--json"], repoRoot)) as {
      session_id: string;
      prompt: string;
    };
    assert.match(parsed.session_id, /^sess_/);
    assert.equal(parsed.prompt, "Capture this session");
    assert.equal(
      JSON.parse(await readFile(path.join(repoRoot, ".story/runtime/current-session.json"), "utf8")).session_id,
      parsed.session_id,
    );
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("CLI can list Codex sessions on a branch", async () => {
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
            session_id: "sess_list_a",
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
            content: [{ type: "input_text", text: "List me" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = (await run(
      ["session", "list-codex", "--branch", "feature/a", "--json"],
      repoRoot,
    )) as Array<{ session_id: string; branch: string; prompt: string }>;

    assert.equal(result.length, 1);
    assert.equal(result[0]?.session_id, "sess_list_a");
    assert.equal(result[0]?.branch, "feature/a");
    assert.equal(result[0]?.prompt, "List me");
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("add_session skill scripts call the Story CLI from the skill directory", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  const sessionFile = path.join(sessionDir, "skill.jsonl");
  const setBranchScript = path.join(
    "/Users/bytedance/Desktop/super/story/skills/add_session/scripts",
    "set_branch.sh",
  );
  const listScript = path.join(
    "/Users/bytedance/Desktop/super/story/skills/add_session/scripts",
    "list_branch_sessions.sh",
  );
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-07-20T13:00:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_skill",
            timestamp: "2026-07-20T13:00:00.000Z",
            cwd: repoRoot,
            originator: "Codex Desktop",
            thread_source: "user",
            model_provider: "webinfra_model",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-20T13:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Skill prompt" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const setResult = await execFileAsync(setBranchScript, ["feature/skill"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        STORY_CODEX_HOME: codexHome,
      },
    });
    const listResult = await execFileAsync(listScript, ["feature/skill"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        STORY_CODEX_HOME: codexHome,
      },
    });

    const updatedLine = (await readFile(sessionFile, "utf8")).split(/\r?\n/).find(Boolean);
    const updatedMeta = JSON.parse(updatedLine ?? "");
    const listed = JSON.parse(listResult.stdout) as Array<{ session_id: string }>;

    assert.match(setResult.stdout, /"branch": "feature\/skill"/);
    assert.equal(updatedMeta.payload.git.branch, "feature/skill");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.session_id, "sess_skill");
  } finally {
    await removeGitRepo(repoRoot);
  }
});

test("CLI can assign the latest Codex session to a branch", async () => {
  const repoRoot = await createGitRepo();
  const codexHome = path.join(repoRoot, ".codex-home");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  const sessionFile = path.join(sessionDir, "latest.jsonl");
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-07-20T11:00:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "sess_cli",
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
            content: [{ type: "input_text", text: "CLI Codex session" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = (await run(
      ["session", "add-codex-branch", "feature/cli", "--json"],
      repoRoot,
    )) as { branch: string; session_id: string };

    const firstLine = (await readFile(sessionFile, "utf8")).split(/\r?\n/).find(Boolean);
    const meta = JSON.parse(firstLine ?? "");
    assert.equal(result.branch, "feature/cli");
    assert.equal(result.session_id, "sess_cli");
    assert.equal(meta.payload.git.branch, "feature/cli");
  } finally {
    await removeGitRepo(repoRoot);
  }
});
