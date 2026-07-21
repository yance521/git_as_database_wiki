export interface Session {
  schema_version: 1;
  session_id: string;
  session_ids?: string[];
  agent: string;
  model: string;
  source_kind: "generic-jsonl" | "codex-rollout" | "codex-rollout-aggregate";
  source_path: string;
  branch: string;
  started_at: string;
  updated_at: string;
  files_touched: string[];
  prompt: string;
  session_sha: string;
  transcript: string;
}

export interface SessionIndex {
  schema_version: 1;
  sessions: Session[];
}
