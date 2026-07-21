import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitRunner } from "../git/git-runner.ts";
import { normalizeTranscript, parseTranscript } from "./jsonl.ts";
import { getStoryPaths } from "./paths.ts";
import type { Session, SessionIndex } from "./models.ts";
import { ensureDir, readJson, sha256, writeJson } from "./utils.ts";

export async function initStoryState(repoRoot: string): Promise<void> {
  const paths = getStoryPaths(repoRoot);
  await Promise.all([
    ensureDir(paths.runtimeDir),
    ensureDir(paths.checkpointsCacheDir),
    ensureDir(paths.reviewsDir),
    ensureDir(paths.handoffsDir),
    ensureDir(paths.hooksDir),
  ]);
  if (!(await readJson<SessionIndex>(paths.sessionsFile))) {
    await writeJson(paths.sessionsFile, { schema_version: 1, sessions: [] });
  }
}

export async function attachSession(
  repoRoot: string,
  transcriptPath: string,
): Promise<Session> {
  await initStoryState(repoRoot);
  const absolutePath = path.resolve(repoRoot, transcriptPath);
  const raw = await readFile(absolutePath, "utf8");
  const transcript = normalizeTranscript(raw);
  const records = parseTranscript(transcript);
  const fileStat = await stat(absolutePath);
  const runner = new GitRunner(repoRoot);
  const sessionSha = sha256(transcript);
  const firstUser = records.find(
    (record) => record.type === "user" || record.role === "user",
  );
  const first = records[0] ?? {};
  const now = new Date().toISOString();
  const sessionId = `sess_${Date.now().toString(36)}_${sessionSha.slice(-8)}`;
  const session: Session = {
    schema_version: 1,
    session_id: sessionId,
    session_ids: [sessionId],
    agent: stringValue(first.agent) ?? "unknown",
    model: stringValue(first.model) ?? "unknown",
    source_kind: "generic-jsonl",
    source_path: absolutePath,
    branch: await runner.branch(),
    started_at: fileStat.birthtime.toISOString(),
    updated_at: now,
    files_touched: await runner.stagedFiles(),
    prompt:
      stringValue(firstUser?.text) ??
      stringValue(firstUser?.content) ??
      "",
    session_sha: sessionSha,
    transcript,
  };
  await persistSession(repoRoot, session);
  return session;
}

export async function autoAttachCodexSession(
  repoRoot: string,
  codexHome?: string,
): Promise<Session | null> {
  await initStoryState(repoRoot);
  const runner = new GitRunner(repoRoot);
  const branch = await runner.branch();
  const lastCommitAt = await runner
    .run(["log", "-1", "--format=%cI", "HEAD"])
    .catch(() => "1970-01-01T00:00:00.000Z");
  const lastCommitMs = Date.parse(lastCommitAt);
  const nowMs = Date.now();
  const matches = await findCodexSessionFiles(repoRoot, codexHome);
  const active = matches.filter((candidate) =>
    candidate.branch === branch &&
    Date.parse(candidate.updated_at) >= lastCommitMs &&
    Date.parse(candidate.updated_at) <= nowMs,
  );
  if (active.length === 0) return null;
  const session = buildCodexSession(active, branch);
  await persistSession(repoRoot, session);
  return session;
}

export async function setLatestCodexSessionBranch(
  repoRoot: string,
  branch: string,
  codexHome?: string,
): Promise<{ session_id: string; branch: string; source_path: string }> {
  const candidates = await findCodexSessionFiles(repoRoot, codexHome, false);
  const latest = candidates
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  if (!latest) {
    throw new Error("No Codex session found for the current repository.");
  }
  const lines = (await readFile(latest.source_path, "utf8")).split(/\r?\n/);
  const updated = lines.map((line) => {
    if (!line.trim()) return line;
    const parsed = JSON.parse(line) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    if (parsed.type !== "session_meta") return line;
    const payload = parsed.payload ?? {};
    const git = objectValue(payload.git);
    return JSON.stringify({
      ...parsed,
      payload: {
        ...payload,
        git: {
          ...git,
          branch,
        },
      },
    });
  });
  await writeFile(latest.source_path, `${updated.join("\n").replace(/\n+$/, "")}\n`, "utf8");
  return {
    session_id: latest.raw_session_id,
    branch,
    source_path: latest.source_path,
  };
}

export interface CodexSessionSummary {
  session_id: string;
  branch: string;
  updated_at: string;
  source_path: string;
  prompt: string;
}

export async function listCodexSessionsByBranch(
  repoRoot: string,
  branch: string,
  codexHome?: string,
): Promise<CodexSessionSummary[]> {
  const candidates = await findCodexSessionFiles(repoRoot, codexHome, true);
  return candidates
    .filter((candidate) => candidate.branch === branch)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map((candidate) => ({
      session_id: candidate.raw_session_id,
      branch: candidate.branch,
      updated_at: candidate.updated_at,
      source_path: candidate.source_path,
      prompt: candidate.prompt,
    }));
}

export async function getCurrentSession(
  repoRoot: string,
): Promise<Session | null> {
  return readJson<Session>(getStoryPaths(repoRoot).currentSessionFile);
}

export async function listSessions(repoRoot: string): Promise<Session[]> {
  const index = await readJson<SessionIndex>(
    getStoryPaths(repoRoot).sessionsFile,
  );
  return index?.sessions ?? [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface CodexSessionCandidate {
  raw_session_id: string;
  agent: "codex";
  model: string;
  cwd: string;
  source_path: string;
  branch: string;
  started_at: string;
  updated_at: string;
  prompt: string;
  transcript: string;
}

async function persistSession(repoRoot: string, session: Session): Promise<void> {
  const paths = getStoryPaths(repoRoot);
  const index =
    (await readJson<SessionIndex>(paths.sessionsFile)) ?? {
      schema_version: 1,
      sessions: [],
    };
  await writeJson(paths.sessionsFile, {
    schema_version: 1,
    sessions: [
      session,
      ...index.sessions.filter((item) => item.session_id !== session.session_id),
    ],
  });
  await writeJson(paths.currentSessionFile, session);
}

async function findCodexSessionFiles(
  repoRoot: string,
  codexHome?: string,
  requireBranch = true,
): Promise<CodexSessionCandidate[]> {
  const home = await resolveCodexHome(repoRoot, codexHome);
  const sessionsRoot = path.join(home, "sessions");
  const files = await listJsonlFiles(sessionsRoot).catch(() => []);
  const normalizedRepoRoot = await normalizePath(repoRoot);
  const candidates = await Promise.all(
    files.map((filePath) => parseCodexSessionFile(filePath)),
  );
  const filtered: CodexSessionCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (requireBranch && !candidate.branch) continue;
    if ((await normalizePath(candidate.cwd)) !== normalizedRepoRoot) continue;
    filtered.push(candidate);
  }
  return filtered;
}

async function parseCodexSessionFile(
  filePath: string,
): Promise<CodexSessionCandidate | null> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let cwd = "";
  let branch = "";
  let model = "unknown";
  let rawSessionId = "";
  let startedAt = "";
  let updatedAt = "";
  let prompt = "";
  for (const line of lines) {
    let entry: {
      timestamp?: string;
      type?: string;
      payload?: Record<string, unknown>;
    };
    try {
      entry = JSON.parse(line) as {
        timestamp?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
    } catch {
      continue;
    }
    const timestamp = stringValue(entry.timestamp);
    if (timestamp) {
      if (!startedAt || timestamp < startedAt) startedAt = timestamp;
      if (!updatedAt || timestamp > updatedAt) updatedAt = timestamp;
    }
    if (entry.type === "session_meta") {
      const payload = entry.payload ?? {};
      cwd = stringValue(payload.cwd) ?? cwd;
      rawSessionId = stringValue(payload.session_id) ?? rawSessionId;
      model = stringValue(payload.model_provider) ?? model;
      branch = stringValue(objectValue(payload.git).branch) ?? branch;
      startedAt = stringValue(payload.timestamp) ?? startedAt;
    }
    if (!prompt && entry.type === "response_item") {
      const payload = entry.payload ?? {};
      if (payload.type === "message" && payload.role === "user") {
        prompt = extractInputText(payload.content) ?? prompt;
      }
    }
  }
  if (!cwd || !rawSessionId || !startedAt || !updatedAt) return null;
  return {
    raw_session_id: rawSessionId,
    agent: "codex",
    model,
    cwd,
    source_path: filePath,
    branch,
    started_at: startedAt,
    updated_at: updatedAt,
    prompt,
    transcript: raw,
  };
}

function buildCodexSession(
  matches: CodexSessionCandidate[],
  branch: string,
): Session {
  const sorted = [...matches].sort((left, right) =>
    left.started_at.localeCompare(right.started_at),
  );
  const transcript = sorted.map((item) => item.transcript.trimEnd()).join("\n");
  const sessionSha = sha256(transcript);
  const prompt = sorted.map((item) => item.prompt).find(Boolean) ?? "";
  return {
    schema_version: 1,
    session_id: `sess_codex_${sessionSha.slice(-12)}`,
    session_ids: sorted.map((item) => item.raw_session_id),
    agent: "codex",
    model: sorted.map((item) => item.model).find(Boolean) ?? "unknown",
    source_kind: sorted.length === 1 ? "codex-rollout" : "codex-rollout-aggregate",
    source_path: sorted.map((item) => item.source_path).join(","),
    branch,
    started_at: sorted[0].started_at,
    updated_at: sorted[sorted.length - 1].updated_at,
    files_touched: [],
    prompt,
    session_sha: sessionSha,
    transcript,
  };
}

async function resolveCodexHome(repoRoot: string, override?: string): Promise<string> {
  if (override) return override;
  const local = path.join(repoRoot, ".codex-home");
  try {
    const info = await stat(local);
    if (info.isDirectory()) return local;
  } catch {}
  if (process.env.STORY_CODEX_HOME) return process.env.STORY_CODEX_HOME;
  return path.join(process.env.HOME ?? "", ".codex");
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return listJsonlFiles(target);
      return entry.name.endsWith(".jsonl") ? [target] : [];
    }),
  );
  return nested.flat();
}

function extractInputText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const value = stringValue((item as { text?: unknown }).text);
    if (value) return value;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function normalizePath(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}
