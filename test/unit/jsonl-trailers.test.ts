import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTranscript,
  parseTranscript,
} from "../../src/core/jsonl.ts";
import {
  appendMissingTrailers,
  parseTrailers,
} from "../../src/core/trailers.ts";

test("normalizes JSONL line endings and rejects non-object records", () => {
  const normalized = normalizeTranscript('{"type":"user","text":"hello"}\r\n\r\n');
  assert.equal(normalized, '{"type":"user","text":"hello"}\n');
  assert.deepEqual(parseTranscript(normalized), [
    { type: "user", text: "hello" },
  ]);
  assert.throws(
    () => parseTranscript('["not","an","object"]\n'),
    /line 1 must be a JSON object/,
  );
});

test("extracts trailers and appends each missing value only once", () => {
  const session = {
    session_id: "sess_demo",
    session_sha: "sha256:session",
  };
  const first = appendMissingTrailers(
    "feat: capture memory\n",
    session,
    "cp_demo_0",
    "sha256:content",
  );
  const second = appendMissingTrailers(
    first,
    session,
    "cp_demo_0",
    "sha256:content",
  );

  assert.equal(second, first);
  assert.deepEqual(parseTrailers(second), {
    "Story-Checkpoint": ["cp_demo_0"],
    "Story-Session": ["sess_demo"],
    "Story-Session-SHA": ["sha256:session"],
    "Story-Content-Hash": ["sha256:content"],
  });
});

test("appends all raw session ids for aggregated sessions", () => {
  const session = {
    session_id: "sess_codex_aggregate",
    session_ids: ["codex_a", "codex_b"],
    session_sha: "sha256:aggregate",
  };
  const message = appendMissingTrailers(
    "feat: aggregate codex sessions\n",
    session,
    "cp_demo_0",
    "sha256:content",
  );

  assert.deepEqual(parseTrailers(message), {
    "Story-Checkpoint": ["cp_demo_0"],
    "Story-Session": ["codex_a", "codex_b"],
    "Story-Session-SHA": ["sha256:aggregate"],
    "Story-Content-Hash": ["sha256:content"],
  });
});
